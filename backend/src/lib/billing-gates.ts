import type { NextFunction, Request, Response } from "express";
import { getSubscriptionAccess } from "../billing-access.js";
import { pool } from "../db.js";
import { getBarbershopId } from "../middleware/auth.js";

/** Planos que podem conectar o WhatsApp (o Essencial é só painel + link de agendamento, sem IA nem WhatsApp). */
const PLANS_WITH_WHATSAPP = new Set(["pro", "premium"]);

export type GateResult = { ok: true } | { ok: false; status: 402 | 403; code: "subscription_blocked" | "plan_required"; message: string };

/**
 * Gate de plano/assinatura para CONECTAR o WhatsApp (backend, não só o front):
 * - assinatura bloqueada (carência vencida) → 402 `subscription_blocked`;
 * - plano Essencial → 403 `plan_required`.
 * Quem já está conectado não é desconectado por isso (só a nova conexão/vínculo é barrada).
 */
export async function whatsappConnectGate(barbershopId: string): Promise<GateResult> {
  const access = await getSubscriptionAccess(barbershopId);
  if (!access.allowed) {
    return { ok: false, status: 402, code: "subscription_blocked", message: access.message ?? "Assinatura inativa. Atualize o pagamento para conectar o WhatsApp." };
  }
  const r = await pool.query<{ billing_plan: string }>(`SELECT COALESCE(billing_plan, 'pro') AS billing_plan FROM public.barbershops WHERE id = $1`, [barbershopId]);
  const plan = r.rows[0]?.billing_plan ?? "pro";
  if (!PLANS_WITH_WHATSAPP.has(plan)) {
    return { ok: false, status: 403, code: "plan_required", message: "Conectar o WhatsApp exige o plano Pro ou Premium. Faça o upgrade em Configurações → Plano." };
  }
  return { ok: true };
}

/** Middleware para as rotas que conectam/vinculam o WhatsApp. */
export async function requireWhatsAppConnectAllowed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const gate = await whatsappConnectGate(getBarbershopId(req));
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.message, code: gate.code });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
}
