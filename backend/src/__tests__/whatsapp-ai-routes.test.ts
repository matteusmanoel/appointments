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

describe("WhatsApp AI routes", () => {
  let barbershopId: string | null = null;
  let token: string = "";

  beforeAll(async () => {
    try {
      const r = await pool.query<{ id: string }>("SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1");
      barbershopId = r.rows[0]?.id ?? null;
      if (barbershopId) token = makeToken(barbershopId);
    } catch {
      barbershopId = null;
    }
  });

  it("GET /api/integrations/whatsapp/ai-settings returns settings", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .get("/api/integrations/whatsapp/ai-settings")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("enabled");
    expect(res.body).toHaveProperty("timezone");
    expect(res.body).toHaveProperty("agent_profile");
    expect(res.body).toHaveProperty("additional_instructions");
  });

  it("PUT /api/integrations/whatsapp/ai-settings accepts agent_profile", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .put("/api/integrations/whatsapp/ai-settings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        agent_profile: { tonePreset: "formal", emojiLevel: "low" },
        additional_instructions: null,
      })
      .expect(200);
    expect(res.body.agent_profile).toBeDefined();
    expect(res.body.agent_profile.tonePreset).toBe("formal");
  });

  it("POST /api/integrations/whatsapp/ai-settings/publish creates version", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .post("/api/integrations/whatsapp/ai-settings/publish")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("version_id");
    expect(res.body.status).toBe("active");
  });

  it("GET /api/integrations/whatsapp/ai-settings/versions returns list", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .get("/api/integrations/whatsapp/ai-settings/versions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.versions)).toBe(true);
  });

  it("POST /api/integrations/whatsapp/ai-simulate returns reply and violations", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .post("/api/integrations/whatsapp/ai-simulate")
      .set("Authorization", `Bearer ${token}`)
      .send({
        messages: [{ role: "user", content: "Oi" }],
        draft_profile: { tonePreset: "default", emojiLevel: "medium" },
      })
      .expect(200);
    expect(res.body).toHaveProperty("reply");
    expect(res.body).toHaveProperty("violations");
    expect(Array.isArray(res.body.violations)).toBe(true);
  });

  it("POST /api/integrations/whatsapp/ai-analyze-chat returns recommendations", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .post("/api/integrations/whatsapp/ai-analyze-chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ chat_text: "Cliente: Oi\nAtendente: Como posso ajudar?", objectives: ["menos emoji"] })
      .expect(200);
    expect(res.body).toHaveProperty("risk_notes");
    expect(res.body).toHaveProperty("expected_outcomes");
  });
});
