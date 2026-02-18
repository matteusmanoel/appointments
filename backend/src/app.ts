import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { apiRouter } from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/billing.js";

export const app = express();
const corsOrigins = config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
);
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json());

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
