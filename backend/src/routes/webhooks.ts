import { Router, Request, Response } from "express";

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const n8nChatTriggerUrl = process.env.N8N_CHAT_TRIGGER_URL ?? "";

export const webhooksRouter = Router();

webhooksRouter.get("/whatsapp", (req: Request, res: Response): void => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
    res.type("text/plain").send(challenge);
    return;
  }
  res.status(403).send("Forbidden");
});

webhooksRouter.post("/whatsapp", async (req: Request, res: Response): Promise<void> => {
  res.status(200).send(); // acknowledge immediately
  const body = req.body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from: string;
            type: string;
            text?: { body: string };
          }>;
        };
      }>;
    }>;
  };
  if (body?.object !== "whatsapp_business_account" || !body.entry?.length) return;
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages;
      if (!messages?.length) continue;
      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text?.body) continue;
        const from = msg.from;
        const text = msg.text.body;
        let reply = "Desculpe, o atendimento automático está temporariamente indisponível.";
        if (n8nChatTriggerUrl && accessToken && phoneNumberId) {
          try {
            const resp = await fetch(n8nChatTriggerUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ from, text, sessionId: from }),
            });
            const data = (await resp.json().catch(() => ({}))) as { output?: string; reply?: string };
            reply = data.output ?? data.reply ?? reply;
          } catch {
            reply = "Erro ao processar. Tente novamente em instantes.";
          }
        }
        try {
          await fetch(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: from.replace(/\D/g, ""),
                type: "text",
                text: { body: reply },
              }),
            }
          );
        } catch (e) {
          console.error("WhatsApp send error:", e);
        }
      }
    }
  }
});
