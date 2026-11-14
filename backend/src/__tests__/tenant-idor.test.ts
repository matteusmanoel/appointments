import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../app.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { createPublicRoutesFixtures, deletePublicRoutesFixtures, type PublicRoutesFixture } from "./helpers/public-routes.js";
import { findForeignRefs } from "../lib/tenant-refs.js";
import { createAppointment } from "../ai/tools.js";

type Tenant = { fx: PublicRoutesFixture; clientId: string; serviceId: string; planId: string; token: string };

async function mkTenant(): Promise<Tenant> {
  const fx = await createPublicRoutesFixtures({ appointmentOffsetDays: 1, appointmentTime: "14:00" });
  const c = await pool.query<{ id: string }>("SELECT id FROM public.clients WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId]);
  const s = await pool.query<{ id: string }>("SELECT id FROM public.services WHERE barbershop_id = $1 LIMIT 1", [fx.barbershopId]);
  const p = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershop_plans (barbershop_id, name, service_ids, price) VALUES ($1, 'Plano T', $2, 50) RETURNING id`,
    [fx.barbershopId, [s.rows[0].id]],
  );
  const token = jwt.sign(
    { profileId: "00000000-0000-0000-0000-000000000001", barbershopId: fx.barbershopId, role: "admin", email: "t@test.com" },
    config.jwtSecret ?? "test-secret",
  );
  return { fx, clientId: c.rows[0].id, serviceId: s.rows[0].id, planId: p.rows[0].id, token };
}

describe("Isolamento entre tenants (IDOR) em ids de body/query", () => {
  let A: Tenant | null = null;
  let B: Tenant | null = null;
  let date = "";
  let toolsKey = "";

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    A = await mkTenant();
    B = await mkTenant();
    const d = await pool.query<{ d: string }>(
      `SELECT d::date::text AS d FROM generate_series(CURRENT_DATE + 3, CURRENT_DATE + 10, '1 day') d WHERE extract(dow from d) <> 0 ORDER BY d LIMIT 1`,
    );
    date = d.rows[0].d;
    toolsKey = `bfk_legacy-${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    await pool.query("INSERT INTO public.barbershop_api_keys (barbershop_id, key_hash, name) VALUES ($1, $2, 'teste idor')", [
      A.fx.barbershopId,
      await bcrypt.hash(toolsKey, 4),
    ]).catch(async () => {
      await pool.query("INSERT INTO public.barbershop_api_keys (barbershop_id, key_hash) VALUES ($1, $2)", [A!.fx.barbershopId, await bcrypt.hash(toolsKey, 4)]);
    });
  });

  afterAll(async () => {
    if (A) await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = $1", [A.fx.barbershopId]);
    for (const t of [A, B]) {
      if (!t) continue;
      await pool.query("DELETE FROM public.client_plan_subscriptions WHERE barbershop_id = $1", [t.fx.barbershopId]).catch(() => {});
      await pool.query("DELETE FROM public.barbershop_plans WHERE barbershop_id = $1", [t.fx.barbershopId]);
      await deletePublicRoutesFixtures([t.fx.barbershopId]);
    }
  });

  const post = (path: string, tk: string, body: unknown) => request(app).post(path).set("Authorization", `Bearer ${tk}`).send(body as object);
  const appt = (o: Partial<{ client_id: string; barber_id: string; service_id: string }>) => ({
    client_id: A!.clientId, barber_id: A!.fx.barberId, service_id: A!.serviceId, scheduled_date: date, scheduled_time: "10:00", ...o,
  });

  it("helper: id de outro tenant, inexistente e malformado são tratados igual", async () => {
    if (!A || !B) return;
    const r = await findForeignRefs(A.fx.barbershopId, { clients: [A.clientId, B.clientId, "00000000-0000-0000-0000-0000000000ff", "x"] });
    expect(r).toHaveLength(1);
    expect(r[0].ids.sort()).toEqual([B.clientId, "00000000-0000-0000-0000-0000000000ff", "x"].sort());
    expect(await findForeignRefs(A.fx.barbershopId, { clients: [A.clientId], barbers: [A.fx.barberId], services: [A.serviceId] })).toEqual([]);
  });

  it("POST /appointments: client_id, barber_id e service_id de OUTRO tenant → 404 e nada é gravado", async () => {
    if (!A || !B) return;
    const before = await pool.query("SELECT count(*)::int AS n FROM public.appointments WHERE barbershop_id = $1", [A.fx.barbershopId]);
    for (const o of [{ client_id: B.clientId }, { barber_id: B.fx.barberId }, { service_id: B.serviceId }]) {
      const r = await post("/api/appointments", A.token, appt(o));
      expect(r.status, JSON.stringify(o)).toBe(404);
    }
    const after = await pool.query("SELECT count(*)::int AS n FROM public.appointments WHERE barbershop_id = $1", [A.fx.barbershopId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("POST /appointments com ids do próprio tenant continua funcionando (201)", async () => {
    if (!A) return;
    const r = await post("/api/appointments", A.token, appt({}));
    expect(r.status).toBe(201);
  });

  it("GET /appointments?barber_id=<outro tenant> → 404; malformado → 404", async () => {
    if (!A || !B) return;
    const h = { Authorization: `Bearer ${A.token}` };
    expect((await request(app).get(`/api/appointments?barber_id=${B.fx.barberId}`).set(h)).status).toBe(404);
    expect((await request(app).get(`/api/appointments?barber_id=nao-e-uuid`).set(h)).status).toBe(404);
    expect((await request(app).get(`/api/appointments?barber_id=${A.fx.barberId}`).set(h)).status).toBe(200);
  });

  it("id de rota malformado vira 404 (antes: 500 do Postgres)", async () => {
    if (!A) return;
    for (const p of ["/api/appointments/xyz", "/api/clients/xyz", "/api/barbers/xyz", "/api/services/xyz", "/api/plans/xyz"]) {
      expect((await request(app).get(p).set("Authorization", `Bearer ${A.token}`)).status, p).toBe(404);
    }
  });

  it("recursos de A não aparecem para B por id (GET /clients/:id, /barbers/:id, /services/:id)", async () => {
    if (!A || !B) return;
    const h = { Authorization: `Bearer ${B.token}` };
    expect((await request(app).get(`/api/clients/${A.clientId}`).set(h)).status).toBe(404);
    expect((await request(app).get(`/api/barbers/${A.fx.barberId}`).set(h)).status).toBe(404);
    expect((await request(app).get(`/api/services/${A.serviceId}`).set(h)).status).toBe(404);
  });

  it("planos: service_ids de outro tenant → 404 (POST e PUT); assinatura com cliente/plano de outro tenant → 404", async () => {
    if (!A || !B) return;
    expect((await post("/api/plans", A.token, { name: "X", price: 10, service_ids: [B.serviceId] })).status).toBe(404);
    const put = await request(app).put(`/api/plans/${A.planId}`).set("Authorization", `Bearer ${A.token}`).send({ service_ids: [B.serviceId] });
    expect(put.status).toBe(404);
    expect((await post("/api/plans/subscriptions", A.token, { client_id: B.clientId, plan_id: A.planId })).status).toBe(404);
    expect((await post("/api/plans/subscriptions", A.token, { client_id: A.clientId, plan_id: B.planId })).status).toBe(404);
  });

  it("campanha e reativação com client_ids de outro tenant → 404", async () => {
    if (!A || !B) return;
    const camp = await post("/api/integrations/automations/campaigns", A.token, { name: "c", body: "oi", client_ids: [A.clientId, B.clientId] });
    
    expect(camp.status).toBe(404);
    const re = await post("/api/intelligence/reactivation/queue", A.token, { client_ids: [B.clientId] });
    expect(re.status).toBe(404);
  });

  it("/tools: create_appointment com client_id/barber_id de outro tenant → 404; list_appointments com barber de outro tenant → 404", async () => {
    if (!A || !B) return;
    const h = { "x-api-key": toolsKey };
    const mk = (o: object) => ({ client_id: A!.clientId, barber_id: A!.fx.barberId, service_id: A!.serviceId, date, time: "15:00", ...o });
    expect((await request(app).post("/api/tools/create_appointment").set(h).send(mk({ client_id: B.clientId }))).status).toBe(404);
    expect((await request(app).post("/api/tools/create_appointment").set(h).send(mk({ barber_id: B.fx.barberId }))).status).toBe(404);
    expect((await request(app).post("/api/tools/create_appointment").set(h).send(mk({ service_id: B.serviceId }))).status).toBe(404);
    expect((await request(app).get(`/api/tools/list_appointments?date=${date}&barber_id=${B.fx.barberId}`).set(h)).status).toBe(404);
    expect((await request(app).post("/api/tools/create_appointment").set(h).send(mk({}))).status).toBe(201);
  });

  it("agente (createAppointment): client_id de outro tenant é recusado", async () => {
    if (!A || !B) return;
    const r = (await createAppointment(A.fx.barbershopId, {
      client_id: B.clientId,
      barber_id: A.fx.barberId,
      service_ids: [A.serviceId],
      date,
      time: "16:00",
    } as never)) as { error?: string; id?: string };
    expect(r.error).toBeTruthy();
    expect(r.id).toBeUndefined();
  });
});
