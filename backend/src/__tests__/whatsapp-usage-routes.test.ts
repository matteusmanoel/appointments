import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";

function makeToken(barbershopId: string, role = "admin"): string {
  return jwt.sign(
    { profileId: "test-usage-profile", barbershopId, role, email: "usage@test.com" },
    config.jwtSecret ?? "test-secret",
  );
}

describe("GET /api/integrations/whatsapp/usage (tenant do JWT)", () => {
  const stamp = Date.now();
  let shopA = "";
  let shopB = "";
  let convA = "";

  beforeAll(async () => {
    const a = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Uso IA A', '551199990001', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-usage-a-${stamp}`],
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Uso IA B', '551199990002', 'premium', $1, '{}'::jsonb) RETURNING id`,
      [`test-usage-b-${stamp}`],
    );
    shopA = a.rows[0]!.id;
    shopB = b.rows[0]!.id;
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', $2, false) RETURNING id`,
      [shopA, `5511${stamp}usage`],
    );
    convA = conv.rows[0]!.id;
    // 400 respostas no mês corrente (São Paulo): 80% do plano pro (500), abaixo do teto.
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content)
       SELECT $1, 'assistant', 'ok' FROM generate_series(1, 400)`,
      [convA],
    );
  });

  afterAll(async () => {
    if (shopA) await pool.query("DELETE FROM public.ai_conversations WHERE barbershop_id = $1", [shopA]);
    if (shopA) await pool.query("DELETE FROM public.barbershops WHERE id = $1", [shopA]);
    if (shopB) await pool.query("DELETE FROM public.barbershops WHERE id = $1", [shopB]);
  });

  it("sem token responde 401", async () => {
    const res = await request(app).get("/api/integrations/whatsapp/usage");
    expect(res.status).toBe(401);
  });

  it("devolve o uso do tenant autenticado, com limiar e flags, isolado de outro tenant", async () => {
    const resA = await request(app)
      .get("/api/integrations/whatsapp/usage")
      .set("Authorization", `Bearer ${makeToken(shopA)}`)
      .expect(200);
    expect(resA.body).toMatchObject({
      used: 400,
      limit: 500,
      billingPlan: "pro",
      softExceeded: false,
      hardExceeded: false,
      thresholdPct: 80,
      thresholdExceeded: true,
    });

    const resB = await request(app)
      .get("/api/integrations/whatsapp/usage")
      .set("Authorization", `Bearer ${makeToken(shopB, "attendant")}`)
      .expect(200);
    expect(resB.body).toMatchObject({
      used: 0,
      limit: 2000,
      billingPlan: "premium",
      softExceeded: false,
      hardExceeded: false,
      thresholdPct: 80,
      thresholdExceeded: false,
    });
  });
});
