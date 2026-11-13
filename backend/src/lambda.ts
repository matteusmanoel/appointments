import serverless from "serverless-http";
import { app } from "./app.js";
import { startupWhatsappWarnings } from "./integrations/whatsapp/provider-config.js";

for (const line of startupWhatsappWarnings()) console.warn(line);

export const handler = serverless(app, {
  binary: false,
});
