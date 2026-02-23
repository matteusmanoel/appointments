import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db.js";
import {
  createPublicRoutesFixtures,
  deletePublicRoutesFixtures,
  type PublicRoutesFixture,
} from "./helpers/public-routes.js";

describe("Public cancel/reschedule", () => {
  let fixturesFuture: PublicRoutesFixture | null = null;
  let fixturesPast: PublicRoutesFixture | null = null;
  let fixturesClosedDay: PublicRoutesFixture | null = null;
  let fixturesReschedule: PublicRoutesFixture | null = null;
  const barbershopIds: string[] = [];

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    fixturesFuture = await createPublicRoutesFixtures({
      appointmentOffsetDays: 1,
      appointmentTime: "14:00",
    });
    fixturesPast = await createPublicRoutesFixtures({
      appointmentOffsetDays: -1,
      appointmentTime: "10:00",
    });
    const tomorrow = await pool.query<{ d: string }>(
      "SELECT (CURRENT_DATE + 1)::text AS d"
    );
    const tomorrowStr = tomorrow.rows[0].d;
    fixturesClosedDay = await createPublicRoutesFixtures({
      appointmentOffsetDays: 1,
      appointmentTime: "14:00",
      closureDate: tomorrowStr,
      closureStatus: "closed",
    });
    fixturesReschedule = await createPublicRoutesFixtures({
      appointmentOffsetDays: 1,
      appointmentTime: "14:00",
    });
    if (fixturesFuture) barbershopIds.push(fixturesFuture.barbershopId);
    if (fixturesPast) barbershopIds.push(fixturesPast.barbershopId);
    if (fixturesClosedDay) barbershopIds.push(fixturesClosedDay.barbershopId);
    if (fixturesReschedule) barbershopIds.push(fixturesReschedule.barbershopId);
  });

  afterAll(async () => {
    if (barbershopIds.length > 0) await deletePublicRoutesFixtures(barbershopIds);
  });

  it("GET /api/public/appointments/:token returns 200 for valid token and 404 for bad token", async () => {
    if (!fixturesFuture) return;
    const valid = await request(app)
      .get(`/api/public/appointments/${fixturesFuture.publicToken}`)
      .expect(200);
    expect(valid.body.id).toBe(fixturesFuture.appointmentId);
    expect(valid.body.scheduled_date).toBe(fixturesFuture.scheduledDate);
    expect(valid.body.barbershop_name).toBeDefined();

    const bad = await request(app)
      .get("/api/public/appointments/00000000-0000-0000-0000-000000000000")
      .expect(404);
    expect(bad.body.error).toContain("não encontrado");
  });

  it("POST /api/public/appointments/:token/cancel returns 400 when startUtc <= now", async () => {
    if (!fixturesPast) return;
    const res = await request(app)
      .post(`/api/public/appointments/${fixturesPast.publicToken}/cancel`)
      .expect(400);
    expect(res.body.error).toMatch(/já passou|não é possível cancelar/);
  });

  it("POST /api/public/appointments/:token/cancel returns 200 when appointment in future", async () => {
    if (!fixturesFuture) return;
    const res = await request(app)
      .post(`/api/public/appointments/${fixturesFuture.publicToken}/cancel`)
      .expect(200);
    expect(res.body.ok).toBe(true);
    const row = await pool.query(
      "SELECT status FROM public.appointments WHERE id = $1",
      [fixturesFuture.appointmentId]
    );
    expect(row.rows[0]?.status).toBe("cancelled");
  });

  it("POST /api/public/appointments/:token/reschedule returns 400 for invalid body", async () => {
    if (!fixturesReschedule) return;
    const res = await request(app)
      .post(`/api/public/appointments/${fixturesReschedule.publicToken}/reschedule`)
      .send({})
      .expect(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /api/public/appointments/:token/reschedule returns 400 when slot is on closed day", async () => {
    if (!fixturesClosedDay) return;
    const tomorrow = await pool.query<{ d: string }>(
      "SELECT (CURRENT_DATE + 1)::text AS d"
    );
    const dateStr = tomorrow.rows[0].d;
    const res = await request(app)
      .post(`/api/public/appointments/${fixturesClosedDay.publicToken}/reschedule`)
      .send({
        scheduled_date: dateStr,
        scheduled_time: "10:00",
        barber_id: fixturesClosedDay.barberId,
      })
      .expect(400);
    expect(res.body.error).toMatch(/fechada|expediente/);
  });

  it("POST /api/public/appointments/:token/reschedule returns 400 when time outside business hours", async () => {
    if (!fixturesReschedule) return;
    const tomorrow = await pool.query<{ d: string }>(
      "SELECT (CURRENT_DATE + 1)::text AS d"
    );
    const dateStr = tomorrow.rows[0].d;
    const res = await request(app)
      .post(`/api/public/appointments/${fixturesReschedule.publicToken}/reschedule`)
      .send({
        scheduled_date: dateStr,
        scheduled_time: "08:00",
        barber_id: fixturesReschedule.barberId,
      })
      .expect(400);
    expect(res.body.error).toMatch(/expediente|Horário/);
  });

  it("POST /api/public/appointments/:token/reschedule returns 200 for valid slot", async () => {
    if (!fixturesReschedule) return;
    const tomorrow = await pool.query<{ d: string }>(
      "SELECT (CURRENT_DATE + 1)::text AS d"
    );
    const dateStr = tomorrow.rows[0].d;

    const res = await request(app)
      .post(`/api/public/appointments/${fixturesReschedule.publicToken}/reschedule`)
      .send({
        scheduled_date: dateStr,
        scheduled_time: "10:00",
        barber_id: fixturesReschedule.barberId,
      })
      .expect(200);

    expect(res.body.id).toBe(fixturesReschedule.appointmentId);
    expect(res.body.scheduled_date).toBe(dateStr);
    expect(res.body.scheduled_time).toMatch(/10:00/);

    const row = await pool.query(
      "SELECT scheduled_date::text, scheduled_time::text FROM public.appointments WHERE id = $1",
      [fixturesReschedule.appointmentId]
    );
    expect(row.rows[0]?.scheduled_date).toBe(dateStr);
    expect(row.rows[0]?.scheduled_time).toMatch(/10:00/);
  });
});
