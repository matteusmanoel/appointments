import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import {
  createPublicRoutesFixtures,
  deletePublicRoutesFixtures,
  type PublicRoutesFixture,
} from "./helpers/public-routes.js";

describe("Double booking: link público e painel", () => {
  let fx: PublicRoutesFixture | null = null;
  let slug = "";
  let serviceId = "";
  let clientId = "";
  let freeDate = "";
  let token = "";

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    fx = await createPublicRoutesFixtures({ appointmentOffsetDays: 1, appointmentTime: "14:00" });
    const s = await pool.query<{ slug: string }>("SELECT slug FROM public.barbershops WHERE id = $1", [fx.barbershopId]);
    slug = s.rows[0].slug;
    const sv = await pool.query<{ id: string }>("SELECT id FROM public.services WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId]);
    serviceId = sv.rows[0].id;
    const c = await pool.query<{ id: string }>("SELECT id FROM public.clients WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId]);
    clientId = c.rows[0].id;
    // próxima data de seg–sáb com pelo menos 2 dias à frente (expediente 09–18 no fixture)
    const d = await pool.query<{ d: string }>(
      `SELECT d::date::text AS d FROM generate_series(CURRENT_DATE + 2, CURRENT_DATE + 9, '1 day') d WHERE extract(dow from d) <> 0 ORDER BY d LIMIT 1`
    );
    freeDate = d.rows[0].d;
    token = jwt.sign(
      { profileId: "test-profile", barbershopId: fx.barbershopId, role: "manager", email: "t@test.com" },
      config.jwtSecret ?? "test-secret"
    );
  });

  afterAll(async () => {
    if (fx) await deletePublicRoutesFixtures([fx.barbershopId]);
  });

  const body = (time: string, date = freeDate, i = 0) => ({
    service_id: serviceId,
    barber_id: fx!.barberId,
    scheduled_date: date,
    scheduled_time: time,
    client_name: `Cliente ${i}`,
    client_phone: `55119999${String(10000 + i)}`,
  });

  it("10 pedidos simultâneos para o mesmo horário no link público: só 1 vence (201), os demais 409", async () => {
    if (!fx) return;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => request(app).post(`/api/public/${slug}/appointments`).send(body("10:00", freeDate, i)))
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    const n = await pool.query(
      "SELECT count(*)::int AS n FROM public.appointments WHERE barber_id = $1 AND scheduled_date = $2::date AND scheduled_time = '10:00' AND status <> 'cancelled'",
      [fx.barberId, freeDate]
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("painel + link público disputando o mesmo horário: só 1 vence", async () => {
    if (!fx) return;
    const panel = (i: number) =>
      request(app)
        .post("/api/appointments")
        .set("Authorization", `Bearer ${token}`)
        .send({ client_id: clientId, barber_id: fx!.barberId, service_id: serviceId, scheduled_date: freeDate, scheduled_time: "11:00" });
    const results = await Promise.all([
      panel(0), panel(1), panel(2),
      request(app).post(`/api/public/${slug}/appointments`).send(body("11:00", freeDate, 50)),
      request(app).post(`/api/public/${slug}/appointments`).send(body("11:00", freeDate, 51)),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it("horário sobreposto (11:15 com serviço de 30 min contra 11:00) é recusado", async () => {
    if (!fx) return;
    const r = await request(app).post(`/api/public/${slug}/appointments`).send(body("11:15", freeDate, 60));
    expect(r.status).toBe(409);
  });

  it("link público recusa horário no passado", async () => {
    if (!fx) return;
    const past = await pool.query<{ d: string }>("SELECT (CURRENT_DATE - 2)::text AS d");
    const r = await request(app).post(`/api/public/${slug}/appointments`).send(body("10:00", past.rows[0].d, 70));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/passado/);
  });

  it("link público recusa fora do expediente (22:00) e dia fechado (domingo)", async () => {
    if (!fx) return;
    const late = await request(app).post(`/api/public/${slug}/appointments`).send(body("22:00", freeDate, 71));
    expect(late.status).toBe(400);
    expect(late.body.error).toMatch(/expediente/);
    const sun = await pool.query<{ d: string }>(
      `SELECT d::date::text AS d FROM generate_series(CURRENT_DATE + 2, CURRENT_DATE + 9, '1 day') d WHERE extract(dow from d) = 0 LIMIT 1`
    );
    const closed = await request(app).post(`/api/public/${slug}/appointments`).send(body("10:00", sun.rows[0].d, 72));
    expect(closed.status).toBe(400);
    expect(closed.body.error).toMatch(/não abre/);
  });

  it("GET barbers do link público expõe a escala (schedule) para o front esconder horários inválidos", async () => {
    if (!fx) return;
    const r = await request(app).get(`/api/public/${slug}/barbers`).expect(200);
    expect(r.body[0].schedule).toBeTruthy();
  });
});
