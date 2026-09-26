import OpenAI from "openai";
import { config } from "../config.js";
import { getBase64FromMediaMessage } from "../integrations/whatsapp/evolution-client.js";
import { decideReceiptAcceptance, type ReceiptFacts } from "./parse-receipt.js";

function asFacts(raw: unknown): ReceiptFacts {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const amount = Number(r.amount);
  return {
    readable: r.readable === true,
    recipient: typeof r.recipient === "string" && r.recipient.trim() ? r.recipient.trim() : null,
    transferDate:
      typeof r.transfer_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.transfer_date)
        ? r.transfer_date
        : null,
    amount: Number.isFinite(amount) ? amount : null,
  };
}

export async function readReceiptFromMedia(params: {
  instanceName: string;
  providerEventId: string;
  mimetype?: string;
  openai?: OpenAI;
  fetchMedia?: (instanceName: string, providerEventId: string) => Promise<{ base64: string; mimetype?: string }>;
}): Promise<ReceiptFacts> {
  try {
    const fetchMedia = params.fetchMedia ?? getBase64FromMediaMessage;
    const media = await fetchMedia(params.instanceName, params.providerEventId);
    const buf = Buffer.from(media.base64, "base64");
    if (!buf.length) return { readable: false, recipient: null, transferDate: null, amount: null };
    const mime = (params.mimetype || media.mimetype || "image/jpeg").split(";")[0] || "image/jpeg";
    const openai = params.openai ?? (config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null);
    if (!openai) return { readable: false, recipient: null, transferDate: null, amount: null };
    const dataUrl = `data:${mime};base64,${media.base64}`;
    const out = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Leia o comprovante PIX. Responda JSON: {"readable":boolean,"recipient":string|null,"transfer_date":"YYYY-MM-DD"|null,"amount":number|null}. recipient = nome ou chave do destinatário. Sem inventar.',
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Comprovante:" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const text = out.choices[0]?.message?.content ?? "{}";
    return asFacts(JSON.parse(text));
  } catch {
    return { readable: false, recipient: null, transferDate: null, amount: null };
  }
}

export { decideReceiptAcceptance };
