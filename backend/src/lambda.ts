import serverless from "serverless-http";
import { app } from "./app.js";
import { whatsappConfigProblems, resolveWhatsAppProvider } from "./integrations/whatsapp/provider-config.js";

for (const p of whatsappConfigProblems()) console.warn(`[startup] whatsapp(${resolveWhatsAppProvider()}): ${p}`);

export const handler = serverless(app, {
  binary: false,
});
