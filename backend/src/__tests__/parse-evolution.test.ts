import { describe, it, expect } from "vitest";
import {
  parseEvolutionConnectionUpdate,
  parseEvolutionInbound,
} from "../integrations/whatsapp/parse-evolution.js";

describe("parseEvolutionInbound", () => {
  it("maps messages.upsert text to canonical inbound", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.1", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" },
        message: { conversation: "Quero cortar o cabelo" },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.fromMe).toBe(false);
    expect(r.fromPhone).toBe("5511999999999");
    expect(r.text).toBe("Quero cortar o cabelo");
    expect(r.providerEventId).toBe("wamid.1");
    expect(r.instanceKey).toBe("nh-abc");
  });

  it("fromMe is skip + handoffCandidate", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.2", fromMe: true, remoteJid: "5511888888888@s.whatsapp.net" },
        message: { conversation: "Agenda: João cancelou 14h" },
      },
    });
    expect(r.skip).toBe(true);
    expect(r.fromMe).toBe(true);
    expect(r.handoffCandidate).toBe(true);
    expect(r.fromPhone).toBe("5511888888888");
    expect(r.providerEventId).toBe("wamid.2");
  });

  it("accepts WhatsApp LID when remoteJidAlt or senderPn has the phone", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-0778d591d0894342",
      data: {
        key: {
          id: "3B564CAEEEDE1CB87832",
          fromMe: false,
          remoteJid: "239012345678901@lid",
          remoteJidAlt: "554588230845@s.whatsapp.net",
        },
        message: { conversation: "Oi" },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.fromPhone).toBe("554588230845");
    expect(r.text).toBe("Oi");
    expect(r.providerEventId).toBe("3B564CAEEEDE1CB87832");
  });

  it("accepts LID-only JID when local part looks like a BR phone", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.lid", fromMe: false, remoteJid: "554588230845@lid" },
        message: { conversation: "Quero agendar" },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.fromPhone).toBe("554588230845");
  });

  it("accepts text when WhatsApp includes messageContextInfo metadata", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-0778d591d0894342",
      data: {
        key: {
          id: "3BE7F7CCE2298476D87C",
          fromMe: false,
          remoteJid: "554588230845@s.whatsapp.net",
          remoteJidAlt: "554588230845@s.whatsapp.net",
          addressingMode: "lid",
        },
        message: {
          messageContextInfo: { deviceListMetadataVersion: 2 },
          conversation: "Oi",
        },
        messageType: "conversation",
      },
    });
    expect(r.skip).toBe(false);
    expect(r.fromPhone).toBe("554588230845");
    expect(r.text).toBe("Oi");
    expect(r.providerEventId).toBe("3BE7F7CCE2298476D87C");
  });

  it("accepts extended text when metadata keys come first", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.ext", fromMe: false, remoteJid: "5511987654321@s.whatsapp.net" },
        message: {
          messageContextInfo: { deviceListMetadataVersion: 2 },
          extendedTextMessage: { text: "Tem horário amanhã?" },
        },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.text).toBe("Tem horário amanhã?");
    expect(r.fromPhone).toBe("5511987654321");
  });

  it("skips non upsert events", () => {
    const r = parseEvolutionInbound({
      event: "connection.update",
      instance: "nh-abc",
    });
    expect(r.skip).toBe(true);
    expect(r.fromMe).toBe(false);
  });

  it("maps connection.update open/close without treating it as inbound chat", () => {
    expect(
      parseEvolutionConnectionUpdate({
        event: "connection.update",
        instance: "nh-abc",
        data: { state: "open", wuid: "5545988432998:1@s.whatsapp.net" },
      }),
    ).toEqual({ instanceKey: "nh-abc", state: "connected", phone: "5545988432998" });
    expect(
      parseEvolutionConnectionUpdate({
        event: "connection.update",
        instance: "nh-abc",
        data: { state: "close" },
      }),
    ).toEqual({ instanceKey: "nh-abc", state: "disconnected", phone: null });
    expect(parseEvolutionConnectionUpdate({ event: "messages.upsert", instance: "nh-abc" })).toBeNull();
  });

  it("flags inbound audio without text so the worker can transcribe", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.audio", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" },
        message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.mediaKind).toBe("audio");
    expect(r.text).toBeNull();
    expect(r.providerEventId).toBe("wamid.audio");
    expect(r.fromPhone).toBe("5511999999999");
  });

  it("maps image receipts so inbound does not fall through to greeting", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.pix", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" },
        message: { imageMessage: { mimetype: "image/jpeg", caption: "" } },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.mediaKind).toBe("image");
    expect(r.providerEventId).toBe("wamid.pix");
  });

  it("maps editedMessage protocol to the original stanza id", () => {
    const r = parseEvolutionInbound({
      event: "messages.upsert",
      instance: "nh-abc",
      data: {
        key: { id: "wamid.edit", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" },
        message: {
          protocolMessage: {
            type: "MESSAGE_EDIT",
            key: { id: "wamid.original" },
            editedMessage: { conversation: "agendar" },
          },
        },
      },
    });
    expect(r.skip).toBe(false);
    expect(r.text).toBe("agendar");
    expect(r.editOfProviderEventId).toBe("wamid.original");
  });
});
