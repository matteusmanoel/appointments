import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app.js";
import { pool } from "../db.js";
import { parsePublicPhone } from "../lib/phone-validate.js";
import { createMemoryStore, consume } from "../lib/rate-limit.js";
import {
  createPublicRoutesFixtures,
  deletePublicRoutesFixtures,
  type PublicRoutesFixture,
} from "./helpers/public-routes.js";

// O limiter global do app é por IP (120/min): cada chamada usa um IP de origem diferente via X-Forwarded-For,
// exceto quando o teste quer justamente repetir o IP.
let ipSeq = 0;
const freshIp = () => `172.20.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;
const uniq = () => Math.random().toString(36).slice(2, 8);

const ENV_KEYS = [
  "PUBLIC_RATE_LIMIT_STORE",
  "PUBLIC_RATE_LIMIT_ENABLED",
  "PUBLIC_BOOKING_IP_MAX",
  "PUBLIC_BOOKING_PHONE_MAX",
  "PUBLIC_MANAGE_IP_MAX",
  "PUBLIC_MANAGE_TOKEN_MAX",
  "PUBLIC_MANAGE_PHONE_MAX",
] as const;
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("parsePublicPhone (validação de formato)", () => {
  it("aceita formatos brasileiros comuns e normaliza para dígitos", () => {
    for (const v of ["(45) 98823-0845", "45988230845", "+55 45 98823-0845", "5545988230845", "(11) 3456-7890", "1134567890"]) {
      const p = parsePublicPhone(v);
      expect(p.ok, v).toBe(true);
      if (p.ok) expect(p.digits).toBe(v.replace(/\D/g, ""));
    }
  });

  it("com/sem 55 e com/sem nono dígito caem no mesmo bucket de rate limit", () => {
    const keys = new Set(
      ["45988230845", "(45) 98823-0845", "+55 45 98823-0845", "554588230845", "4588230845"].map((v) => {
        const p = parsePublicPhone(v);
        return p.ok ? p.bucketKey : "INVALID";
      })
    );
    expect([...keys]).toHaveLength(1);
  });

  it("rejeita lixo: letras, curto, longo, DDD inválido, sequência repetida, celular sem 9", () => {
    for (const v of ["", "abc", "123", "4598823", "45 98823-084x", "05988230845", "00988230845", "11111111111", "459882308456789", "45888230845", "' OR 1=1 --", "<script>", 123 as unknown as string]) {
      expect(parsePublicPhone(v).ok, String(v)).toBe(false);
    }
  });

  it("internacional só com + explícito e DDI diferente de 55", () => {
    expect(parsePublicPhone("+351 912 345 678").ok).toBe(true);
    expect(parsePublicPhone("+1 (415) 555-2671").ok).toBe(true);
    expect(parsePublicPhone("351912345678").ok).toBe(false);
  });
});

describe("rate limit: store e consume()", () => {
  it("memory store: conta dentro da janela e reinicia depois", async () => {
    const s = createMemoryStore();
    expect((await s.hit("k", 50)).count).toBe(1);
    expect((await s.hit("k", 50)).count).toBe(2);
    await new Promise((r) => setTimeout(r, 70));
    expect((await s.hit("k", 50)).count).toBe(1);
  });

  it("store postgres: contador atômico compartilhado, com retry-after", async () => {
    process.env.PUBLIC_RATE_LIMIT_STORE = "postgres";
    const bucket = `test:pg:${uniq()}`;
    try {
      await pool.query("SELECT 1 FROM public.rate_limit_hits LIMIT 1");
    } catch {
      return; // migration não aplicada neste banco
    }
    const spec = { bucket, max: 3, windowMs: 60_000 };
    // concorrência: 5 chamadas simultâneas = 5 hits, sem perder contagem
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => consume([spec])));
    expect(results.filter((r) => r !== null)).toHaveLength(2);
    const row = await pool.query("SELECT hits FROM public.rate_limit_hits WHERE bucket = $1", [bucket]);
    expect(row.rows[0].hits).toBe(5);
    const blocked = await consume([spec]);
    expect(blocked?.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked?.retryAfterSec).toBeLessThanOrEqual(60);
    await pool.query("DELETE FROM public.rate_limit_hits WHERE bucket = $1", [bucket]);
  });
});

describe("Endpoints públicos: rate limit + telefone", () => {
  const fixtures: PublicRoutesFixture[] = [];
  let slug = "";
  let serviceId = "";
  let barbershopId = "";
  let barberId = "";
  let ready = false;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    const f = await createPublicRoutesFixtures({ appointmentOffsetDays: 2 });
    fixtures.push(f);
    barbershopId = f.barbershopId;
    barberId = f.barberId;
    slug = (await pool.query<{ slug: string }>("SELECT slug FROM public.barbershops WHERE id = $1", [barbershopId])).rows[0].slug;
    serviceId = (await pool.query<{ id: string }>("SELECT id FROM public.services WHERE barbershop_id = $1 LIMIT 1", [barbershopId])).rows[0].id;
    ready = true;
  });
  afterAll(async () => {
    await deletePublicRoutesFixtures(fixtures.map((f) => f.barbershopId));
  });

  const bookingBody = (phone: string) => ({
    service_id: serviceId,
    barber_id: barberId,
    scheduled_date: "2099-01-05", // segunda-feira, muito à frente (provavelmente cai em 4xx de slot; só importa não ser 429/400-de-telefone)
    scheduled_time: "10:00",
    client_name: "Fulano",
    client_phone: phone,
  });

  it("agendamento público com telefone inválido → 400 (e não grava cliente)", async () => {
    if (!ready) return;
    const before = (await pool.query("SELECT count(*)::int AS n FROM public.clients WHERE barbershop_id = $1", [barbershopId])).rows[0].n;
    for (const bad of ["abc", "123", "11111111111", "45 98823-084x"]) {
      const res = await request(app).post(`/api/public/${slug}/appointments`).set("X-Forwarded-For", freshIp()).send(bookingBody(bad));
      expect(res.status, bad).toBe(400);
    }
    const after = (await pool.query("SELECT count(*)::int AS n FROM public.clients WHERE barbershop_id = $1", [barbershopId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("agendamento público: por IP → 429 com Retry-After após o limite (memória)", async () => {
    if (!ready) return;
    process.env.PUBLIC_RATE_LIMIT_STORE = "memory";
    process.env.PUBLIC_BOOKING_IP_MAX = "3";
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      // telefones diferentes: só o limite por IP pode barrar
      const res = await request(app)
        .post(`/api/public/${slug}/appointments`)
        .set("X-Forwarded-For", ip)
        .send(bookingBody(`1198${String(1000000 + i * 7919).slice(0, 7)}`.replace(/^1198/, "11998")));
      statuses.push(res.status);
      if (i === 4) {
        expect(res.status).toBe(429);
        expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
        expect(res.body.error).toMatch(/tentativas/i);
      }
    }
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    // outro IP não é afetado
    const other = await request(app).post(`/api/public/${slug}/appointments`).set("X-Forwarded-For", freshIp()).send(bookingBody("11998000001"));
    expect(other.status).not.toBe(429);
  });

  it("agendamento público: por telefone → 429 mesmo trocando de IP (store Postgres)", async () => {
    if (!ready) return;
    try {
      await pool.query("SELECT 1 FROM public.rate_limit_hits LIMIT 1");
    } catch {
      return;
    }
    process.env.PUBLIC_RATE_LIMIT_STORE = "postgres";
    process.env.PUBLIC_BOOKING_PHONE_MAX = "2";
    const phone = `4599${String(Math.floor(1000000 + Math.random() * 8999999))}`; // celular válido aleatório
    const variants = [phone, `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`, `+55${phone}`];
    const out: number[] = [];
    for (const v of variants) {
      const res = await request(app).post(`/api/public/${slug}/appointments`).set("X-Forwarded-For", freshIp()).send(bookingBody(v));
      out.push(res.status);
    }
    expect(out[0]).not.toBe(429);
    expect(out[1]).not.toBe(429);
    expect(out[2]).toBe(429); // 3ª tentativa com a mesma pessoa, IP diferente e formatação diferente
    await pool.query("DELETE FROM public.rate_limit_hits WHERE bucket LIKE 'pub:book:%'");
  });

  it("cancelar/reagendar por token: por IP, por token e por telefone do cliente → 429", async () => {
    if (!ready) return;
    process.env.PUBLIC_RATE_LIMIT_STORE = "memory";

    // por token (chuta datas inválidas: 400 do handler, mas conta tentativa)
    process.env.PUBLIC_MANAGE_TOKEN_MAX = "2";
    const token = fixtures[0].publicToken;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post(`/api/public/appointments/${token}/reschedule`).set("X-Forwarded-For", freshIp()).send({});
      codes.push(res.status);
    }
    expect(codes.slice(0, 2).every((c) => c !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
    delete process.env.PUBLIC_MANAGE_TOKEN_MAX;

    // por IP: tokens inexistentes (enumeração) também contam
    process.env.PUBLIC_MANAGE_IP_MAX = "3";
    const ip = freshIp();
    const r: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post(`/api/public/appointments/${randomUUID()}/cancel`).set("X-Forwarded-For", ip);
      r.push(res.status);
    }
    expect(r.slice(0, 3).every((c) => c === 404)).toBe(true);
    expect(r[4]).toBe(429);
    delete process.env.PUBLIC_MANAGE_IP_MAX;

    // por telefone: dois agendamentos (tokens) do mesmo cliente compartilham o limite
    process.env.PUBLIC_MANAGE_PHONE_MAX = "2";
    const f2 = await createPublicRoutesFixtures({ appointmentOffsetDays: 3 });
    fixtures.push(f2);
    const second = await pool.query<{ public_token: string }>(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       SELECT barbershop_id, client_id, barber_id, service_id, scheduled_date, '16:00'::time, duration_minutes, price, commission_amount, 'pending'
       FROM public.appointments WHERE id = $1 RETURNING public_token`,
      [f2.appointmentId]
    );
    const tokens = [f2.publicToken, second.rows[0].public_token, f2.publicToken];
    const res: number[] = [];
    for (const t of tokens) {
      res.push((await request(app).post(`/api/public/appointments/${t}/reschedule`).set("X-Forwarded-For", freshIp()).send({})).status);
    }
    expect(res[0]).not.toBe(429);
    expect(res[1]).not.toBe(429);
    expect(res[2]).toBe(429);
  });

  it("token malformado → 404 imediato (antes: erro do Postgres e requisição pendurada)", async () => {
    if (!ready) return;
    for (const t of ["abc", "0000-1", "' OR 1=1 --"]) {
      const get = await request(app).get(`/api/public/appointments/${encodeURIComponent(t)}`).set("X-Forwarded-For", freshIp());
      expect(get.status, t).toBe(404);
      const post = await request(app).post(`/api/public/appointments/${encodeURIComponent(t)}/cancel`).set("X-Forwarded-For", freshIp());
      expect(post.status, t).toBe(404);
    }
  });

  it("PUBLIC_RATE_LIMIT_ENABLED=false desliga o limiter", async () => {
    if (!ready) return;
    process.env.PUBLIC_RATE_LIMIT_STORE = "memory";
    process.env.PUBLIC_RATE_LIMIT_ENABLED = "false";
    process.env.PUBLIC_MANAGE_IP_MAX = "1";
    const ip = freshIp();
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post(`/api/public/appointments/${randomUUID()}/cancel`).set("X-Forwarded-For", ip);
      expect(res.status).toBe(404);
    }
  });
});
