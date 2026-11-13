import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { createPublicRoutesFixtures, deletePublicRoutesFixtures, type PublicRoutesFixture } from "./helpers/public-routes.js";
import { createAppointment, rescheduleAppointmentByAgent } from "../ai/tools.js";
import { lockBarberDay } from "../lib/booking-lock.js";

let ipSeq = 0;
const freshIp = () => `10.99.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;

describe("Lock por barbeiro/dia em PATCH /appointments/:id, /tools e agente", () => {
  let fx: PublicRoutesFixture | null = null;
  let token = "";
  let toolsKey = "";
  let clientId = "";
  let serviceId = "";
  let longServiceId = "";
  let date = "";
  const clientPhone = "5511999990002";

  const insertAppt = async (time: string, status = "pending"): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 35, 14, $7) RETURNING id`,
      [fx!.barbershopId, clientId, fx!.barberId, serviceId, date, time, status]
    );
    await pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position) VALUES ($1, $2, 35, 30, 'Corte', 0)`,
      [r.rows[0].id, serviceId]
    );
    return r.rows[0].id;
  };
  const clearAppts = async () => {
    await pool.query("DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1 AND scheduled_date = $2::date)", [fx!.barbershopId, date]);
    await pool.query("DELETE FROM public.appointments WHERE barbershop_id = $1 AND scheduled_date = $2::date", [fx!.barbershopId, date]);
  };
  const patch = (id: string, body: object) =>
    request(app).patch(`/api/appointments/${id}`).set("X-Forwarded-For", freshIp()).set("Authorization", `Bearer ${token}`).send(body);
  const count = async (time: string) =>
    (await pool.query("SELECT count(*)::int AS n FROM public.appointments WHERE barbershop_id = $1 AND scheduled_date = $2::date AND scheduled_time = $3::time AND status NOT IN ('cancelled','no_show')", [fx!.barbershopId, date, time])).rows[0].n;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    fx = await createPublicRoutesFixtures({ appointmentOffsetDays: 1, appointmentTime: "09:00" });
    clientId = (await pool.query<{ id: string }>("SELECT id FROM public.clients WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId])).rows[0].id;
    serviceId = (await pool.query<{ id: string }>("SELECT id FROM public.services WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId])).rows[0].id;
    longServiceId = (await pool.query<{ id: string }>(
      "INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active) VALUES ($1, 'Longo', 80, 90, true) RETURNING id", [fx.barbershopId])).rows[0].id;
    date = (await pool.query<{ d: string }>(
      `SELECT d::date::text AS d FROM generate_series(CURRENT_DATE + 3, CURRENT_DATE + 10, '1 day') d WHERE extract(dow from d) <> 0 ORDER BY d LIMIT 1`)).rows[0].d;
    token = jwt.sign({ profileId: "00000000-0000-0000-0000-000000000001", barbershopId: fx.barbershopId, role: "admin", email: "t@test.com" }, config.jwtSecret ?? "test-secret");
    toolsKey = `tk_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const hash = await bcrypt.hash(toolsKey, 4);
    await pool.query("INSERT INTO public.barbershop_api_keys (barbershop_id, key_hash, name) VALUES ($1, $2, 'teste lock')", [fx.barbershopId, hash]).catch(() =>
      pool.query("INSERT INTO public.barbershop_api_keys (barbershop_id, key_hash) VALUES ($1, $2)", [fx!.barbershopId, hash]));
  });

  afterAll(async () => {
    if (!fx) return;
    await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = $1", [fx.barbershopId]);
    await clearAppts();
    await deletePublicRoutesFixtures([fx.barbershopId]);
  });

  it("PATCH: dois agendamentos movidos ao mesmo tempo para o mesmo horário → um 200 e um 409", async () => {
    if (!fx) return;
    await clearAppts();
    const a = await insertAppt("10:00");
    const b = await insertAppt("12:00");
    const [ra, rb] = await Promise.all([patch(a, { scheduled_time: "15:00" }), patch(b, { scheduled_time: "15:00" })]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(await count("15:00")).toBe(1);
  });

  it("PATCH: trocar data para um dia com horário ocupado → 409 e nada muda", async () => {
    if (!fx) return;
    await clearAppts();
    const a = await insertAppt("10:00");
    const b = await insertAppt("11:00");
    const r = await patch(b, { scheduled_time: "10:15" });
    expect(r.status).toBe(409);
    const row = await pool.query("SELECT to_char(scheduled_time,'HH24:MI') AS t FROM public.appointments WHERE id = $1", [b]);
    expect(row.rows[0].t).toBe("11:00");
    expect(a).toBeTruthy();
  });

  it("PATCH: aumentar a duração via service_ids que invade o próximo horário → 409 e serviços intactos (antes: 200, gravava antes de checar)", async () => {
    if (!fx) return;
    await clearAppts();
    const a = await insertAppt("10:00");
    await insertAppt("10:30");
    const r = await patch(a, { service_ids: [longServiceId] });
    expect(r.status).toBe(409);
    const row = await pool.query("SELECT duration_minutes, service_id FROM public.appointments WHERE id = $1", [a]);
    expect(row.rows[0].duration_minutes).toBe(30);
    expect(row.rows[0].service_id).toBe(serviceId);
    const aps = await pool.query("SELECT service_id FROM public.appointment_services WHERE appointment_id = $1", [a]);
    expect(aps.rows.map((x: { service_id: string }) => x.service_id)).toEqual([serviceId]);
    // sem invasão, passa
    const free = await insertAppt("14:00");
    const ok = await patch(free, { service_ids: [longServiceId] });
    expect(ok.status).toBe(200);
    expect(ok.body.duration_minutes).toBe(90);
  });

  it("PATCH: reativar (cancelled → pending) em horário que foi ocupado nesse meio tempo → 409", async () => {
    if (!fx) return;
    await clearAppts();
    const cancelled = await insertAppt("10:00", "cancelled");
    await insertAppt("10:00");
    const r = await patch(cancelled, { status: "pending" });
    expect(r.status).toBe(409);
    // cancelar nunca é bloqueado por conflito; mudar nota/preço também não
    const other = await insertAppt("16:00");
    expect((await patch(other, { status: "cancelled" })).status).toBe(200);
    expect((await patch(other, { notes: "ok" })).status).toBe(200);
  });

  it("/tools create_appointment: duas criações simultâneas no mesmo horário → um 201 e um 409", async () => {
    if (!fx) return;
    await clearAppts();
    const call = () =>
      request(app)
        .post("/api/tools/create_appointment")
        .set("X-Forwarded-For", freshIp())
        .set("x-api-key", toolsKey)
        .send({ client_id: clientId, barber_id: fx!.barberId, service_id: serviceId, date, time: "11:00" });
    const [r1, r2] = await Promise.all([call(), call()]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await count("11:00")).toBe(1);
  });

  it("agente createAppointment: criações simultâneas no mesmo horário → só uma entra", async () => {
    if (!fx) return;
    await clearAppts();
    const run = () =>
      createAppointment(fx!.barbershopId, { client_id: clientId, barber_id: fx!.barberId, service_ids: [serviceId], date, time: "13:00" }) as Promise<{ id?: string; code?: string }>;
    const res = await Promise.all([run(), run(), run()]);
    expect(res.filter((r) => r.id).length).toBe(1);
    expect(res.filter((r) => r.code === "SLOT_CONFLICT").length).toBe(2);
    expect(await count("13:00")).toBe(1);
  });

  it("agente x painel: mesmo lock — POST do painel e createAppointment do agente no mesmo horário não duplicam", async () => {
    if (!fx) return;
    await clearAppts();
    const panel = () =>
      request(app)
        .post("/api/appointments")
        .set("X-Forwarded-For", freshIp())
        .set("Authorization", `Bearer ${token}`)
        .send({ client_id: clientId, barber_id: fx!.barberId, service_id: serviceId, scheduled_date: date, scheduled_time: "15:30" });
    const agent = () =>
      createAppointment(fx!.barbershopId, { client_id: clientId, barber_id: fx!.barberId, service_ids: [serviceId], date, time: "15:30" }) as Promise<{ id?: string }>;
    const [p, a] = await Promise.all([panel(), agent()]);
    const wins = (p.status === 201 ? 1 : 0) + (a.id ? 1 : 0);
    expect(wins).toBe(1);
    expect(await count("15:30")).toBe(1);
  });

  it("o agente respeita o lock tomado por outro caminho (mesma chave): espera o COMMIT em vez de passar por cima", async () => {
    if (!fx) return;
    await clearAppts();
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await lockBarberDay(holder, fx.barberId, date);
      let settled = false;
      const p = (createAppointment(fx.barbershopId, { client_id: clientId, barber_id: fx.barberId, service_ids: [serviceId], date, time: "09:30" }) as Promise<{ id?: string }>).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // antes: chave diferente → não esperava
      await holder.query("COMMIT");
      const r = await p;
      expect(r.id).toBeTruthy();
    } finally {
      holder.release();
    }
  });

  it("agente rescheduleAppointmentByAgent: duas remarcações simultâneas para o mesmo horário → só uma entra", async () => {
    if (!fx) return;
    await clearAppts();
    const a = await insertAppt("10:00");
    const b = await insertAppt("12:00");
    const run = (id: string) => rescheduleAppointmentByAgent(fx!.barbershopId, id, clientPhone, { date, time: "16:30" }) as Promise<{ code?: string; error?: string }>;
    const res = await Promise.all([run(a), run(b)]);
    expect(res.filter((r) => r.code === "SLOT_CONFLICT").length).toBe(1);
    expect(await count("16:30")).toBe(1);
  });
});
