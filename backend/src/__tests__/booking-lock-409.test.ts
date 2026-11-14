import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.BOOKING_LOCK_TIMEOUT_MS = "300"; // prova o 55P03→409 sem esperar 10 s
});

import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { createPublicRoutesFixtures, deletePublicRoutesFixtures, type PublicRoutesFixture } from "./helpers/public-routes.js";
import { bookingLockKey, lockBarberDay, LOCK_BUSY_MESSAGE } from "../lib/booking-lock.js";

// Diferente de outros arquivos de teste: SEM `if (!fx) return` (sem banco o teste FALHA, não passa em branco).
describe("55P03 (lock do barbeiro/dia ocupado) → 409 amigável no POST do painel, no link público e no reagendar", () => {
  let fx: PublicRoutesFixture;
  let slug = "";
  let serviceId = "";
  let clientId = "";
  let date = "";
  let token = "";

  beforeAll(async () => {
    fx = await createPublicRoutesFixtures({ appointmentOffsetDays: 1, appointmentTime: "14:00" });
    slug = (await pool.query<{ slug: string }>("SELECT slug FROM public.barbershops WHERE id = $1", [fx.barbershopId])).rows[0].slug;
    serviceId = (await pool.query<{ id: string }>("SELECT id FROM public.services WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId])).rows[0].id;
    clientId = (await pool.query<{ id: string }>("SELECT id FROM public.clients WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId])).rows[0].id;
    date = (await pool.query<{ d: string }>(
      `SELECT d::date::text AS d FROM generate_series(CURRENT_DATE + 3, CURRENT_DATE + 10, '1 day') d WHERE extract(dow from d) <> 0 ORDER BY d LIMIT 1`)).rows[0].d;
    token = jwt.sign({ profileId: "test-profile", barbershopId: fx.barbershopId, role: "manager", email: "t@test.com" }, config.jwtSecret ?? "test-secret");
  });
  afterAll(async () => {
    if (fx) await deletePublicRoutesFixtures([fx.barbershopId]);
  });

  /** Segura o lock do barbeiro/dia em outra conexão enquanto `fn` roda; usa o barbeiro em MAIÚSCULAS (a chave é normalizada). */
  async function withLockHeld<T>(fn: () => Promise<T>, barberKeyForm = fx.barberId.toUpperCase()): Promise<T> {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await lockBarberDay(holder, barberKeyForm, date);
      return await fn();
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  }

  const rows = async (time: string) =>
    (await pool.query("SELECT count(*)::int AS n FROM public.appointments WHERE barbershop_id = $1 AND scheduled_date = $2::date AND scheduled_time = $3::time AND status NOT IN ('cancelled','no_show')", [fx.barbershopId, date, time])).rows[0].n;

  it("POST /api/appointments (painel): 409 com mensagem amigável, nada gravado", async () => {
    const t0 = Date.now();
    const r = await withLockHeld(() =>
      request(app).post("/api/appointments").set("X-Forwarded-For", "10.98.0.1").set("Authorization", `Bearer ${token}`)
        .send({ client_id: clientId, barber_id: fx.barberId, service_id: serviceId, scheduled_date: date, scheduled_time: "10:00" }));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LOCK_BUSY_MESSAGE);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await rows("10:00")).toBe(0);
  });

  it("POST /api/public/:slug/appointments (link público): 409 amigável, nada gravado", async () => {
    const r = await withLockHeld(() =>
      request(app).post(`/api/public/${slug}/appointments`).set("X-Forwarded-For", "10.98.0.2")
        .send({ service_id: serviceId, barber_id: fx.barberId, scheduled_date: date, scheduled_time: "10:30", client_name: "Cliente Lock", client_phone: "5511999991234" }));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LOCK_BUSY_MESSAGE);
    expect(await rows("10:30")).toBe(0);
  });

  it("POST /api/public/appointments/:token/reschedule: 409 amigável, o agendamento fica onde estava", async () => {
    const r = await withLockHeld(() =>
      request(app).post(`/api/public/appointments/${fx.publicToken}/reschedule`).set("X-Forwarded-For", "10.98.0.3")
        .send({ scheduled_date: date, scheduled_time: "11:00" }));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(LOCK_BUSY_MESSAGE);
    expect(await rows("11:00")).toBe(0);
  });

  it("sem o lock ocupado, os mesmos pedidos funcionam (o 409 vem do lock, não de outra coisa)", async () => {
    const r = await request(app).post("/api/appointments").set("X-Forwarded-For", "10.98.0.4").set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, barber_id: fx.barberId, service_id: serviceId, scheduled_date: date, scheduled_time: "10:00" });
    expect(r.status).toBe(201);
  });
});

describe("chave do lock normalizada", () => {
  const id = "ABCDEF12-3456-7890-ABCD-EF1234567890";
  it("caixa e espaços nas pontas geram a mesma chave", () => {
    expect(bookingLockKey(id, "2026-12-01")).toBe(bookingLockKey(` ${id.toLowerCase()} `, "2026-12-01"));
    expect(bookingLockKey(id, "2026-12-01")).toBe(`booking:${id.toLowerCase()}:2026-12-01`);
  });
  it("ISO com hora vira o dia; data inválida e barbeiro vazio são erros (não uma chave diferente)", () => {
    expect(bookingLockKey(id, "2026-12-01T10:00:00.000Z")).toBe(bookingLockKey(id, "2026-12-01"));
    expect(() => bookingLockKey(id, "01/12/2026")).toThrow();
    expect(() => bookingLockKey("  ", "2026-12-01")).toThrow();
  });

  it("o mesmo barbeiro em MAIÚSCULAS e minúsculas se exclui de verdade (segunda conexão estoura 55P03)", async () => {
    const shop = await createPublicRoutesFixtures({ appointmentOffsetDays: 1 });
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("BEGIN");
      await lockBarberDay(a, shop.barberId.toLowerCase(), "2026-12-01");
      await b.query("BEGIN");
      await expect(lockBarberDay(b, shop.barberId.toUpperCase(), "2026-12-01", 200)).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      await b.query("ROLLBACK").catch(() => undefined);
      a.release();
      b.release();
      await deletePublicRoutesFixtures([shop.barbershopId]);
    }
  });
});
