import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { usagePeriod } from "../ai/usage-alert.js";

function makeToken(barbershopId: string): string {
  return jwt.sign(
    { profileId: "test-profile", barbershopId, role: "manager", email: "test@test.com" },
    config.jwtSecret ?? "test-secret"
  );
}

describe("WhatsApp inbox / conversations routes", () => {
  let barbershopId: string | null = null;
  let token: string = "";
  let conversationId: string | null = null;

  beforeAll(async () => {
    try {
      const r = await pool.query<{ id: string }>("SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1");
      barbershopId = r.rows[0]?.id ?? null;
      if (barbershopId) {
        token = makeToken(barbershopId);
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
           VALUES ($1, 'whatsapp', '5511999999999')
           ON CONFLICT (barbershop_id, channel, external_thread_id) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [barbershopId]
        );
        conversationId = ins.rows[0]?.id ?? null;
      }
    } catch {
      barbershopId = null;
      conversationId = null;
    }
  });

  it("GET /api/integrations/whatsapp/conversations returns list", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .get("/api/integrations/whatsapp/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("conversations");
    expect(Array.isArray(res.body.conversations)).toBe(true);
  });

  it("GET /api/integrations/whatsapp/conversations?status=ai returns 200", async () => {
    if (!barbershopId || !token) return;
    await request(app)
      .get("/api/integrations/whatsapp/conversations?status=ai")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });

  it("GET /api/integrations/whatsapp/conversations/:id/messages returns messages", async () => {
    if (!barbershopId || !token || !conversationId) return;
    const res = await request(app)
      .get(`/api/integrations/whatsapp/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("messages");
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("POST /api/integrations/whatsapp/conversations/:id/assume returns ok", async () => {
    if (!barbershopId || !token || !conversationId) return;
    const res = await request(app)
      .post(`/api/integrations/whatsapp/conversations/${conversationId}/assume`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBeDefined();
  });

  it("POST /api/integrations/whatsapp/conversations/:id/resume returns ok", async () => {
    if (!barbershopId || !token || !conversationId) return;
    const res = await request(app)
      .post(`/api/integrations/whatsapp/conversations/${conversationId}/resume`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /api/integrations/whatsapp/conversations/:id/contact returns contact or fallback", async () => {
    if (!barbershopId || !token || !conversationId) return;
    const res = await request(app)
      .get(`/api/integrations/whatsapp/conversations/${conversationId}/contact`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("fallback_phone");
    expect(res.body.contact === null || typeof res.body.contact === "object").toBe(true);
  });

  it("PATCH /api/integrations/whatsapp/conversations/:id/contact accepts name and notes", async () => {
    if (!barbershopId || !token || !conversationId) return;
    const res = await request(app)
      .patch(`/api/integrations/whatsapp/conversations/${conversationId}/contact`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Cliente Teste Inbox", notes: "Nota de teste" })
      .expect(200);
    expect(res.body.contact).toBeDefined();
    expect(res.body.contact.name).toBe("Cliente Teste Inbox");
    expect(res.body.contact.notes).toBe("Nota de teste");
  });

  it("POST /api/integrations/whatsapp/conversations/start creates or opens conversation", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .post("/api/integrations/whatsapp/conversations/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "5511998887777" })
      .expect(200);
    expect(res.body).toHaveProperty("conversation_id");
    expect(res.body).toHaveProperty("external_thread_id");
  });

  it("DELETE /api/integrations/whatsapp/conversations/:id deletes conversation", async () => {
    if (!barbershopId || !token) return;
    const created = await request(app)
      .post("/api/integrations/whatsapp/conversations/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "5511997776666" })
      .expect(200);
    const id = created.body.conversation_id as string;
    await request(app)
      .delete(`/api/integrations/whatsapp/conversations/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });

  it("GET /api/integrations/whatsapp/conversations/:id/messages 404 for wrong barbershop", async () => {
    if (!token) return;
    const wrongId = "00000000-0000-0000-0000-000000000000";
    await request(app)
      .get(`/api/integrations/whatsapp/conversations/${wrongId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});

describe("GET /api/integrations/whatsapp/conversations: flag IA pausada por limite", () => {
  const stamp = Date.now();
  let shopId = "";
  let otherShop = "";
  let token = "";
  let otherToken = "";
  let convOtherReason = "";
  let convOldMonth = "";
  let convThisMonth = "";
  let convOtherTenant = "";

  async function mkConv(shop: string, suffix: string, followup: boolean): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox, needs_human_followup)
       VALUES ($1, 'whatsapp', $2, false, $3) RETURNING id`,
      [shop, `5511${stamp}${suffix}`, followup],
    );
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Inbox teto IA', '551199990100', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-inbox-cap-${stamp}`],
    );
    const other = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Inbox teto IA B', '551199990101', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-inbox-cap-b-${stamp}`],
    );
    shopId = shop.rows[0]!.id;
    otherShop = other.rows[0]!.id;
    token = makeToken(shopId);
    otherToken = makeToken(otherShop);
    convOtherReason = await mkConv(shopId, "01", true);
    convOldMonth = await mkConv(shopId, "02", true);
    convThisMonth = await mkConv(shopId, "03", false);
    convOtherTenant = await mkConv(otherShop, "04", false);
    await pool.query(
      `INSERT INTO public.ai_hard_cap_notices (conversation_id, period) VALUES ($1, '2020-01'), ($2, $3), ($4, $3)`,
      [convOldMonth, convThisMonth, usagePeriod(), convOtherTenant],
    );
  });

  afterAll(async () => {
    if (shopId) {
      await pool.query("DELETE FROM public.ai_conversations WHERE barbershop_id = $1", [shopId]);
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [shopId]);
    }
    if (otherShop) {
      await pool.query("DELETE FROM public.ai_conversations WHERE barbershop_id = $1", [otherShop]);
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [otherShop]);
    }
  });

  it("o badge ia_paused_by_limit vem do aviso do mês atual; needs_human_followup de outro motivo ou mês velho não acende", async () => {
    const res = await request(app)
      .get("/api/integrations/whatsapp/conversations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = res.body.conversations as Array<{ id: string; ia_paused_by_limit?: boolean }>;
    const byId = (id: string) => list.find((c) => c.id === id);
    expect(byId(convOtherReason)).toMatchObject({ ia_paused_by_limit: false });
    expect(byId(convOldMonth)).toMatchObject({ ia_paused_by_limit: false });
    expect(byId(convThisMonth)).toMatchObject({ ia_paused_by_limit: true });
    expect(list.some((c) => c.id === convOtherTenant)).toBe(false);

    const resB = await request(app)
      .get("/api/integrations/whatsapp/conversations")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(200);
    const listB = resB.body.conversations as Array<{ id: string; ia_paused_by_limit?: boolean }>;
    expect(listB.find((c) => c.id === convOtherTenant)).toMatchObject({ ia_paused_by_limit: true });
    expect(listB.some((c) => c.id === convThisMonth)).toBe(false);
  });
});
