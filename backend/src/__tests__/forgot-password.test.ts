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

  it("returns 204 (mesma resposta) quando não existe conta para o e-mail — sem enumeração", async () => {
    if (!dbAvailable) return;
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nonexistent@example.com" })
      .expect(204);
  });

  it("existing email: 204, NÃO altera a senha e cria token de uso único", async () => {
    if (!dbAvailable || !testEmail) return;
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: testEmail })
      .expect(204);

    const r = await pool.query<{ must_change_password: boolean; password_hash: string; id: string }>(
      "SELECT id, must_change_password, password_hash FROM public.profiles WHERE email = $1",
      [testEmail]
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].password_hash).toBe(originalPasswordHash);
    const t = await pool.query("SELECT 1 FROM public.password_reset_tokens WHERE profile_id = $1 AND used_at IS NULL", [r.rows[0].id]);
    expect(t.rows.length).toBe(1);
  });

  it("reset-password: token inválido → 400; token válido troca a senha uma única vez", async () => {
    if (!dbAvailable || !testEmail) return;
    await request(app).post("/api/auth/reset-password").send({ token: "x".repeat(64), new_password: "novaSenha123" }).expect(400);
    const crypto = await import("node:crypto");
    const prof = await pool.query<{ id: string }>("SELECT id FROM public.profiles WHERE email = $1", [testEmail]);
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO public.password_reset_tokens (profile_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')",
      [prof.rows[0].id, crypto.createHash("sha256").update(token).digest("hex")]
    );
    await request(app).post("/api/auth/reset-password").send({ token, new_password: "curta" }).expect(400);
    await request(app).post("/api/auth/reset-password").send({ token, new_password: "novaSenha123" }).expect(204);
    await request(app).post("/api/auth/login").send({ email: testEmail, password: "novaSenha123" }).expect(200);
    await request(app).post("/api/auth/reset-password").send({ token, new_password: "outraSenha456" }).expect(400);
  });

  it("reset-password: token expirado → 400", async () => {
    if (!dbAvailable || !testEmail) return;
    const crypto = await import("node:crypto");
    const prof = await pool.query<{ id: string }>("SELECT id FROM public.profiles WHERE email = $1", [testEmail]);
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO public.password_reset_tokens (profile_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 minute')",
      [prof.rows[0].id, crypto.createHash("sha256").update(token).digest("hex")]
    );
    await request(app).post("/api/auth/reset-password").send({ token, new_password: "novaSenha789" }).expect(400);
  });
});
