import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";

function makeToken(barbershopId: string): string {
  return jwt.sign(
    { profileId: "test-profile", barbershopId, role: "admin", email: "test@test.com" },
    config.jwtSecret ?? "test-secret",
  );
}

describe("PATCH /api/barbershops geo and pix_key", () => {
  let barbershopId: string | null = null;
  let token = "";

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    const slug = `test-geo-pix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ($1, '5511999990000', 'pro', $2, '{"monday":{"start":"09:00","end":"19:00"}}'::jsonb)
       RETURNING id`,
      [`Test Geo Pix ${slug}`, slug],
    );
    barbershopId = shop.rows[0].id;
    token = makeToken(barbershopId);
  });

  afterAll(async () => {
    if (barbershopId) {
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [barbershopId]);
    }
  });

  it("persists latitude, longitude and pix_key and returns them on GET", async () => {
    if (!barbershopId || !token) return;
    const patched = await request(app)
      .patch("/api/barbershops")
      .set("Authorization", `Bearer ${token}`)
      .send({
        latitude: -25.4843059,
        longitude: -54.5654339,
        pix_key: "45988432998",
      })
      .expect(200);
    expect(patched.body.latitude).toBeCloseTo(-25.4843059, 6);
    expect(patched.body.longitude).toBeCloseTo(-54.5654339, 6);
    expect(patched.body.pix_key).toBe("45988432998");

    const got = await request(app)
      .get("/api/barbershops")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(got.body.latitude).toBeCloseTo(-25.4843059, 6);
    expect(got.body.longitude).toBeCloseTo(-54.5654339, 6);
    expect(got.body.pix_key).toBe("45988432998");
  });
});
