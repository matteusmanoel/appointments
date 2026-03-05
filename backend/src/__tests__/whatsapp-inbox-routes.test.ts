import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";

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
