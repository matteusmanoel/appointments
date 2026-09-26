export type EvolutionConnectionUpdate = {
  instanceKey: string;
  state: "disconnected" | "connecting" | "connected";
  phone: string | null;
};

function mapConnectionState(raw: string): EvolutionConnectionUpdate["state"] {
  const state = raw.toLowerCase();
  if (state === "open" || state === "connected") return "connected";
  if (state === "connecting" || state === "qr" || state === "pair") return "connecting";
  return "disconnected";
}

/** Evolution v2 `connection.update` — socket lifecycle, not a chat message. */
export function parseEvolutionConnectionUpdate(body: unknown): EvolutionConnectionUpdate | null {
  const root = asRecord(body);
  if (!root) return null;
  const event = String(root.event ?? root.Event ?? "").toLowerCase();
  if (!event.includes("connection.update") && event !== "connection_update") return null;
  const instanceKey = String(root.instance ?? root.instanceName ?? "").trim();
  const data = asRecord(root.data) ?? root;
  const nested = asRecord(data.instance) ?? data;
  const stateRaw = String(nested.state ?? nested.status ?? data.state ?? data.status ?? "");
  const wuid = String(nested.wuid ?? data.wuid ?? nested.owner ?? data.owner ?? "");
  const phone = phoneFromJid(wuid) ?? phoneFromJid(String(nested.phone ?? data.phone ?? ""));
  return { instanceKey, state: mapConnectionState(stateRaw), phone };
}

export type CanonicalInbound = {
  skip: boolean;
  fromMe: boolean;
  handoffCandidate: boolean;
  instanceKey: string;
  fromPhone: string | null;
  text: string | null;
  providerEventId: string | undefined;
  mediaKind?: "audio" | "image" | "document" | null;
  editOfProviderEventId?: string | null;
  /** WhatsApp contact label. Panel only — not the agent client name. */
  pushName?: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function extractText(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  if (typeof message.conversation === "string" && message.conversation.trim()) {
    return message.conversation.trim();
  }
  const ext = asRecord(message.extendedTextMessage);
  if (typeof ext?.text === "string" && ext.text.trim()) return ext.text.trim();
  for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
    const block = asRecord(message[key]);
    if (typeof block?.caption === "string" && block.caption.trim()) return block.caption.trim();
  }
  const edited = asRecord(message.editedMessage);
  if (edited) {
    const nested = asRecord(edited.message) ?? edited;
    const fromEdited = extractText(nested);
    if (fromEdited) return fromEdited;
  }
  const proto = asRecord(message.protocolMessage);
  if (proto) {
    const protoEdited = asRecord(proto.editedMessage);
    if (protoEdited) {
      const fromProto = extractText(protoEdited) ?? extractText(asRecord(protoEdited.message));
      if (fromProto) return fromProto;
    }
  }
  return null;
}

function isReceiptMedia(
  messageType: string | null,
  message: Record<string, unknown> | null,
): "image" | "document" | null {
  const t = (messageType ?? "").toLowerCase();
  if (t === "imagemessage" || t === "image") return "image";
  if (t === "documentmessage" || t === "document") return "document";
  if (!message) return null;
  if (asRecord(message.imageMessage)) return "image";
  const doc = asRecord(message.documentMessage);
  if (doc) {
    const mime = String(doc.mimetype ?? "").toLowerCase();
    if (mime.includes("pdf") || mime.includes("image")) return "document";
    if (String(doc.fileName ?? "").toLowerCase().endsWith(".pdf")) return "document";
  }
  return null;
}

function isAudioType(messageType: string | null, message: Record<string, unknown> | null): boolean {
  const t = (messageType ?? "").toLowerCase();
  if (t === "audiomessage" || t === "ptt" || t === "audio") return true;
  if (!message) return false;
  return Boolean(asRecord(message.audioMessage) || asRecord(message.pttMessage));
}

function extractEdit(message: Record<string, unknown> | null): { stanzaId: string; text: string } | null {
  if (!message) return null;
  const proto = asRecord(message.protocolMessage);
  const editedBlock = asRecord(message.editedMessage);
  const typeRaw = String(proto?.type ?? proto?.editedType ?? "");
  const isEdit =
    Boolean(editedBlock) ||
    /edit/i.test(typeRaw) ||
    typeRaw === "14" ||
    typeRaw === "MESSAGE_EDIT";
  if (!isEdit) return null;
  const key = asRecord(proto?.key) ?? asRecord(editedBlock?.key);
  const stanzaId = String(key?.id ?? proto?.stanzaId ?? editedBlock?.stanzaId ?? "").trim();
  const text =
    extractText(asRecord(proto?.editedMessage)) ??
    extractText(asRecord(asRecord(proto?.editedMessage)?.message)) ??
    extractText(editedBlock) ??
    extractText(asRecord(editedBlock?.message));
  if (!stanzaId || !text) return null;
  return { stanzaId, text };
}

function collectItems(payload: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const data = payload.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const r = asRecord(item);
      if (r) out.push(r);
    }
  } else {
    const d = asRecord(data);
    if (d) {
      if (d.key || d.message) out.push(d);
      else if (Array.isArray(d.messages)) {
        for (const m of d.messages) {
          const r = asRecord(m);
          if (r) out.push(r);
        }
      }
    }
  }
  if (!out.length && (payload.key || payload.message)) out.push(payload);
  return out;
}

function isMetadataKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === "messagecontextinfo" || k === "contextinfo" || k === "senderkeydistributionmessage" || k.endsWith("contextinfo");
}

function contentMessageType(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  const keys = Object.keys(message).filter((k) => !isMetadataKey(k));
  const conversation = keys.find((k) => k === "conversation");
  if (conversation) return conversation;
  const proto = keys.find((k) => /message$/i.test(k) || k.toLowerCase().includes("message"));
  return proto ?? keys[0] ?? null;
}

function isTextType(messageType: string | null): boolean {
  if (!messageType) return true;
  const t = messageType.toLowerCase();
  return t === "conversation" || t === "extendedtextmessage" || t === "chat" || t === "text";
}

function phoneFromJid(jid: string): string | null {
  if (!jid || jid.includes("@g.us")) return null;
  const local = jid.replace(/@.*$/, "").split(":")[0] ?? "";
  const digits = local.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function firstPhone(jids: string[]): string | null {
  for (const jid of jids) {
    if (!jid || jid.includes("@lid")) continue;
    const phone = phoneFromJid(jid);
    if (phone) return phone;
  }
  for (const jid of jids) {
    const phone = phoneFromJid(jid);
    if (phone) return phone;
  }
  return null;
}

function extractPushName(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;
  const item = collectItems(root)[0];
  const raw = String(item?.pushName ?? "").trim();
  return raw ? raw.slice(0, 120) : null;
}

/** Parse Evolution v2 `messages.upsert` (and similar) into the same inbound contract as Uazapi. */
export function parseEvolutionInbound(body: unknown): CanonicalInbound {
  const parsed = parseEvolutionInboundBody(body);
  return { ...parsed, pushName: extractPushName(body) };
}

function parseEvolutionInboundBody(body: unknown): CanonicalInbound {
  const root = asRecord(body);
  if (!root) {
    return {
      skip: true,
      fromMe: false,
      handoffCandidate: false,
      instanceKey: "",
      fromPhone: null,
      text: null,
      providerEventId: undefined,
    };
  }

  const event = String(root.event ?? root.Event ?? "").toLowerCase();
  const instanceKey = String(root.instance ?? root.instanceName ?? "").trim();

  if (
    event &&
    !event.includes("messages.upsert") &&
    event !== "messages_upsert" &&
    !event.includes("messages.update") &&
    event !== "messages_update"
  ) {
    return {
      skip: true,
      fromMe: false,
      handoffCandidate: false,
      instanceKey,
      fromPhone: null,
      text: null,
      providerEventId: undefined,
    };
  }

  const item = collectItems(root)[0];
  if (!item) {
    return {
      skip: true,
      fromMe: false,
      handoffCandidate: false,
      instanceKey,
      fromPhone: null,
      text: null,
      providerEventId: undefined,
    };
  }

  const key = asRecord(item.key) ?? {};
  const message = asRecord(item.message);
  const fromMe = Boolean(key.fromMe ?? item.fromMe);
  const messageId = String(key.id ?? item.id ?? "").trim() || undefined;
  const remoteJid = String(key.remoteJid ?? item.remoteJid ?? "");
  const remoteJidAltRaw = key.remoteJidAlt ?? item.remoteJidAlt;
  const remoteJidAlt =
    remoteJidAltRaw != null && String(remoteJidAltRaw).trim() ? String(remoteJidAltRaw) : "";
  const senderPn = String(key.senderPn ?? item.senderPn ?? item.sender_pn ?? "");
  const participantAlt = String(key.participantAlt ?? item.participantAlt ?? "");

  if (remoteJid.includes("@g.us") || remoteJidAlt.includes("@g.us")) {
    return {
      skip: true,
      fromMe,
      handoffCandidate: false,
      instanceKey,
      fromPhone: null,
      text: null,
      providerEventId: messageId,
    };
  }

  const fromPhone = firstPhone([senderPn, participantAlt, remoteJidAlt, remoteJid]);
  const edit = extractEdit(message);
  const text = edit?.text ?? extractText(message);
  const messageType = contentMessageType(message);
  const audio = isAudioType(messageType, message);
  const receiptKind = isReceiptMedia(messageType, message);
  const handoffCandidate = fromMe && !!text && isTextType(messageType);

  if (fromMe) {
    return {
      skip: true,
      fromMe: true,
      handoffCandidate,
      instanceKey,
      fromPhone,
      text: text ?? null,
      providerEventId: messageId,
    };
  }

  if (edit && fromPhone && instanceKey) {
    return {
      skip: false,
      fromMe: false,
      handoffCandidate: false,
      instanceKey,
      fromPhone,
      text: edit.text,
      providerEventId: messageId ?? edit.stanzaId,
      editOfProviderEventId: edit.stanzaId,
    };
  }

  if (audio && fromPhone && instanceKey && messageId) {
    return {
      skip: false,
      fromMe: false,
      handoffCandidate: false,
      instanceKey,
      fromPhone,
      text: text ?? null,
      providerEventId: messageId,
      mediaKind: "audio",
    };
  }

  if (receiptKind && fromPhone && instanceKey && messageId) {
    return {
      skip: false,
      fromMe: false,
      handoffCandidate: false,
      instanceKey,
      fromPhone,
      text: text ?? null,
      providerEventId: messageId,
      mediaKind: receiptKind,
    };
  }

  if (!isTextType(messageType) || !text || !fromPhone || !instanceKey || !messageId) {
    return {
      skip: true,
      fromMe: false,
      handoffCandidate: false,
      instanceKey,
      fromPhone,
      text: text ?? null,
      providerEventId: messageId,
    };
  }

  return {
    skip: false,
    fromMe: false,
    handoffCandidate: false,
    instanceKey,
    fromPhone,
    text,
    providerEventId: messageId,
  };
}
