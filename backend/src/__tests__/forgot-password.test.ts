import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../app.js";
import { pool } from "../db.js";

const TEST_SLUG_PREFIX = "test-forgot-";

describe("POST /api/auth/forgot-password", () => {
  let barbershopId: string | null = null;
  let testEmail: string | null = null;
  let originalPasswordHash: string | null = null;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      dbAvailable = true;
    } catch {
      return;
    }
    const slug = `${TEST_SLUG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testEmail = `forgot-test-${Date.now()}@example.com`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ($1, '5511999990000', 'pro', $2, '{"monday":{"start":"09:00","end":"19:00"}}'::jsonb)
       RETURNING id`,
      [`Test Forgot ${slug}`, slug]
    );
    barbershopId = shop.rows[0].id;
    const hash = await bcrypt.hash("oldPassword123", 10);
    originalPasswordHash = hash;
    await pool.query(
      `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
       VALUES (gen_random_uuid(), $1, 'Test User', $2, $3, 'admin')`,
      [barbershopId, testEmail, hash]
    );
  });

  afterAll(async () => {
    if (testEmail) {
      await pool.query("DELETE FROM public.profiles WHERE email = $1", [testEmail]);
    }
    if (barbershopId) {
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [barbershopId]);
    }
  });

  it("returns 204 for invalid body (no email)", async () => {
    await request(app)
      .post("/api/auth/forgot-password")
      .send({})
      .expect(204);
  });

  it("returns 204 for invalid email format", async () => {
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "not-an-email" })
      .expect(204);
  });

  it("returns 204 for non-existent email", async () => {
    if (!dbAvailable) return;
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nonexistent@example.com" })
      .expect(204);
  });

  it("returns 204 for existing email and sets must_change_password", async () => {
    if (!dbAvailable || !testEmail) return;
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: testEmail })
      .expect(204);

    const r = await pool.query<{ must_change_password: boolean; password_hash: string }>(
      "SELECT must_change_password, password_hash FROM public.profiles WHERE email = $1",
      [testEmail]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].must_change_password).toBe(true);
    expect(r.rows[0].password_hash).not.toBe(originalPasswordHash);
  });
});
