import { app } from "./app.js";
import { config } from "./config.js";
import { ensureCriticalSchema } from "./db/ensure-schema.js";

ensureCriticalSchema()
  .catch((e) => console.warn("[startup] ensureCriticalSchema failed:", e))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`API listening on port ${config.port}`);
    });
  });
