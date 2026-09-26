import "./load-env.js";
import { app } from "./app.js";
import { config } from "./config.js";
import { ensureCriticalSchema } from "./db/ensure-schema.js";
import { startEvolutionKeepalive } from "./integrations/whatsapp/evolution-keepalive.js";

ensureCriticalSchema()
  .catch((e) => console.warn("[startup] ensureCriticalSchema failed:", e))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`API listening on port ${config.port}`);
      startEvolutionKeepalive();
    });
  });
