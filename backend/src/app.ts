import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { apiRouter } from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/billing.js";

export const app = express();
// Necessário quando rodando atrás de proxy (ngrok / API Gateway),
// pois essas camadas injetam `X-Forwarded-For` e o express-rate-limit valida isso.
app.set("trust proxy", 1);
const corsOrigins = config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
);
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
const defaultJson = express.json();
const uazapiText = express.text({ limit: "2mb", type: "*/*" });

// Uazapi webhook can send large payloads and sometimes with non-JSON content-type.
// Parse it as text, then best-effort decode to JSON so `req.body` matches our handlers.
app.use((req, res, next) => {
  if (req.path === "/api/webhooks/uazapi" && req.method === "POST") {
    return uazapiText(req, res, () => {
      const raw = typeof (req as { body?: unknown }).body === "string" ? String((req as { body?: unknown }).body) : "";
      (req as unknown as { rawBody?: string }).rawBody = raw;

      const trimmed = raw.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          (req as { body?: unknown }).body = JSON.parse(trimmed) as unknown;
        } catch {
          (req as { body?: unknown }).body = {};
        }
        return next();
      }

      // Some providers send x-www-form-urlencoded; decode to an object for diagnostics.
      if (trimmed.includes("=")) {
        const params = Object.fromEntries(new URLSearchParams(trimmed));
        const maybeJson = params.payload ?? params.data ?? params.body;
        if (typeof maybeJson === "string") {
          try {
            (req as { body?: unknown }).body = JSON.parse(maybeJson) as unknown;
          } catch {
            (req as { body?: unknown }).body = params;
          }
        } else {
          (req as { body?: unknown }).body = params;
        }
        return next();
      }

      (req as { body?: unknown }).body = {};
      return next();
    });
  }
  return defaultJson(req, res, next);
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests" },
  standardHeaders: true,
  skip: (req) => req.path === "/api/billing/webhook",
});
app.use(limiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", apiRouter);
