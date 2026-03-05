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

describe("Knowledge routes", () => {
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

  it("GET /api/integrations/whatsapp/knowledge/config returns storage_configured", async () => {
    if (!token) return;
    const res = await request(app)
      .get("/api/integrations/whatsapp/knowledge/config")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty("storage_configured");
    expect(typeof res.body.storage_configured).toBe("boolean");
  });

  it("GET /api/integrations/whatsapp/knowledge/sources returns array", async () => {
    if (!token) return;
    const res = await request(app)
      .get("/api/integrations/whatsapp/knowledge/sources")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/integrations/whatsapp/knowledge/documents returns array", async () => {
    if (!token) return;
    const res = await request(app)
      .get("/api/integrations/whatsapp/knowledge/documents")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/integrations/whatsapp/knowledge/sources creates source", async () => {
    if (!barbershopId || !token) return;
    const res = await request(app)
      .post("/api/integrations/whatsapp/knowledge/sources")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Source" })
      .expect(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.name).toBe("Test Source");
    expect(res.body).toHaveProperty("enabled");
  });
});
