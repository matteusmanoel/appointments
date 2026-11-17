/**
 * Contexto do cliente atravessa turno e conversa: serviço de costume, preferências,
 * agendamentos e card pendente. Cada caso olha a resposta, as tools e o banco.
 * Roda com --llm none (intérprete fake). Nada sai para WhatsApp nem para um modelo real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { CLOSING_TODAY_THEN_TOMORROW } from "../ai/booking-draft.js";
import { createFakeSlotInterpreter } from "../ai/agent/slot-interpreter.js";
import { simulatorClientPhone } from "../ai/simulator/namespace.js";
import { runSimulatorReminders } from "../ai/simulator/reminders.js";
import { stubOpenAI } from "../ai/simulator/openai-stub.js";
import {
  runSimulatorTurn,
  startFreshSimulatorConversation,
} from "../ai/simulator/session.js";
import { resetWhatsAppOutbound, useNoopWhatsAppOutbound } from "../integrations/whatsapp/noop-outbound.js";
import { setSimulatorTraceEnabled } from "../ai/simulator/trace.js";

const OPEN_LATE = {
  monday: { start: "09:00", end: "20:00" },
  tuesday: { start: "09:00", end: "20:00" },
  wednesday: { start: "09:00", end: "20:00" },
  thursday: { start: "09:00", end: "20:00" },
  friday: { start: "09:00", end: "20:00" },
  saturday: { start: "09:00", end: "20:00" },
  sunday: { start: "09:00", end: "20:00" },
};

const OPEN_UNTIL_18 = {
  monday: { start: "09:00", end: "18:00" },
  tuesday: { start: "09:00", end: "18:00" },
  wednesday: { start: "09:00", end: "18:00" },
  thursday: { start: "09:00", end: "18:00" },
  friday: { start: "09:00", end: "18:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: { start: "09:00", end: "18:00" },
};

const DAY = "2026-11-16T10:00:00-03:00";
const EVENING = "2026-11-16T18:00:00-03:00";
const AFTER_CLOSE = "2026-11-16T18:20:00-03:00";

const fakeInterpreter = createFakeSlotInterpreter((text) => {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/\bmudar\b/.test(t) || /\btrocar\b/.test(t)) return { intent: "reschedule" };
  return null;
});

type Hours = typeof OPEN_LATE;

type ShopFx = {
  barbershopId: string;
  slug: string;
  corteId: string;
  barbaId: string;
  lucasId: string;
  eduardoId: string;
};

type ApptRow = {
  id: string;
  status: string;
  date: string;
  time: string;
  service: string;
  barber: string;
};

type MemoryRow = {
  services: string[];
  barber: string | null;
  barberConf: number;
  timeStart: string | null;
  timeEnd: string | null;
  session: { lastIntent?: string | null; bookingDraft?: { status?: string; confirmCard?: { kind?: string } } } | null;
};

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function seedShop(suffix: string, hours: Hours = OPEN_LATE): Promise<ShopFx> {
  const slug = `ctx-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, $2, 'pro', $3, $4::jsonb) RETURNING id`,
    [`Contexto ${suffix}`, "5500000000077", slug, JSON.stringify(hours)],
  );
  const barbershopId = shop.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
     ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
    [barbershopId],
  );
  const lucas = await pool.query<{ id: string }>(
    `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Lucas', 'active') RETURNING id`,
    [barbershopId],
  );
  const eduardo = await pool.query<{ id: string }>(
    `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Eduardo', 'active') RETURNING id`,
    [barbershopId],
  );
  const corte = await pool.query<{ id: string }>(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active, category)
     VALUES ($1, 'Corte', 40, 30, true, 'corte') RETURNING id`,
    [barbershopId],
  );
  const barba = await pool.query<{ id: string }>(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active, category)
     VALUES ($1, 'Barba', 35, 30, true, 'barba') RETURNING id`,
    [barbershopId],
  );
  return {
    barbershopId,
    slug,
    corteId: corte.rows[0]!.id,
    barbaId: barba.rows[0]!.id,
    lucasId: lucas.rows[0]!.id,
    eduardoId: eduardo.rows[0]!.id,
  };
}

async function wipe(fx: ShopFx) {
  await pool.query(`DELETE FROM public.ai_simulator_turn_traces WHERE barbershop_id = $1`, [fx.barbershopId]).catch(() => undefined);
  await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [fx.barbershopId]).catch(() => undefined);
  const convs = await pool.query<{ id: string }>(`SELECT id FROM public.ai_conversations WHERE barbershop_id = $1`, [
    fx.barbershopId,
  ]);
  for (const row of convs.rows) {
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [row.id]);
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [row.id]);
  }
  await pool.query(`DELETE FROM public.ai_conversations WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(
    `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1)`,
    [fx.barbershopId],
  );
  await pool.query(`DELETE FROM public.appointments WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.client_ai_memory WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [fx.barbershopId]);
}

type Chat = {
  fx: ShopFx;
  displayPhone: string;
  sandboxPhone: string;
  conversationId: string;
  now: string;
  replies: string[];
  tools: string[][];
};

function flatten(reply: string): string {
  return reply.replace(/\[\[MSG\]\]/g, "\n");
}

function assertHuman(reply: string) {
  const t = flatten(reply).toLowerCase();
  expect(t).not.toMatch(/secret[aá]ria virtual/);
  expect(t).not.toMatch(/no-show/);
  expect(t).not.toMatch(/sou (uma )?ia\b/);
  expect(t).not.toMatch(/intelig[eê]ncia artificial/);
  expect(t).not.toMatch(/sou humano/);
  expect(t).not.toMatch(/n[aã]o sou (um )?rob[oô]/);
}

async function openChat(fx: ShopFx, displayPhone: string, now: string): Promise<Chat> {
  useNoopWhatsAppOutbound();
  const conversationId = await startFreshSimulatorConversation(fx.barbershopId, displayPhone);
  return {
    fx,
    displayPhone,
    sandboxPhone: simulatorClientPhone(fx.barbershopId, displayPhone),
    conversationId,
    now,
    replies: [],
    tools: [],
  };
}

async function fresh(chat: Chat, now?: string) {
  if (now) chat.now = now;
  chat.conversationId = await startFreshSimulatorConversation(chat.fx.barbershopId, chat.displayPhone);
}

async function say(chat: Chat, text: string, now?: string): Promise<string> {
  if (now) chat.now = now;
  const trace = await runSimulatorTurn({
    barbershopId: chat.fx.barbershopId,
    conversationId: chat.conversationId,
    phone: chat.sandboxPhone,
    userText: text,
    now: chat.now,
    openai: stubOpenAI(),
    slotInterpreter: fakeInterpreter,
    slotInterpret: true,
    persistAssistantMessages: true,
  });
  const reply = trace.finalReply ?? "";
  chat.replies.push(reply);
  chat.tools.push((trace.tools ?? []).map((tool) => tool.name));
  assertHuman(reply);
  return reply;
}

async function remind(chat: Chat, now?: string): Promise<string> {
  if (now) chat.now = now;
  const sent = await runSimulatorReminders({
    barbershopId: chat.fx.barbershopId,
    conversationId: chat.conversationId,
    phone: chat.sandboxPhone,
    now: chat.now,
  });
  const body = sent.map((row) => row.body).join("\n");
  expect(body.length).toBeGreaterThan(0);
  assertHuman(body);
  return body;
}

async function listAppts(chat: Chat): Promise<ApptRow[]> {
  const r = await pool.query<{
    id: string;
    status: string;
    date: string;
    time: string;
    service: string | null;
    barber: string | null;
  }>(
    `SELECT a.id, a.status, a.scheduled_date::text AS date, a.scheduled_time::text AS time,
            (SELECT string_agg(aps.service_name, ', ' ORDER BY aps.position)
               FROM public.appointment_services aps WHERE aps.appointment_id = a.id) AS service,
            b.name AS barber
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     JOIN public.barbers b ON b.id = a.barber_id
     WHERE a.barbershop_id = $1
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $2
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [chat.fx.barbershopId, chat.sandboxPhone],
  );
  return r.rows.map((row) => ({
    id: row.id,
    status: row.status,
    date: String(row.date).slice(0, 10),
    time: String(row.time).slice(0, 5),
    service: row.service ?? "",
    barber: row.barber ?? "",
  }));
}

async function loadMemory(chat: Chat): Promise<MemoryRow | null> {
  const r = await pool.query<{
    services: unknown;
    barber: string | null;
    barber_conf: number | null;
    time_start: string | null;
    time_end: string | null;
    session: unknown;
  }>(
    `SELECT m.preferred_services AS services, b.name AS barber,
            m.preferred_barber_conf AS barber_conf,
            m.preferred_time_start::text AS time_start,
            m.preferred_time_end::text AS time_end,
            m.session_context AS session
     FROM public.client_ai_memory m
     JOIN public.clients c ON c.id = m.client_id
     LEFT JOIN public.barbers b ON b.id = m.preferred_barber_id
     WHERE m.barbershop_id = $1
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $2`,
    [chat.fx.barbershopId, chat.sandboxPhone],
  );
  const row = r.rows[0];
  if (!row) return null;
  const services = Array.isArray(row.services) ? row.services.map((name) => String(name)) : [];
  return {
    services,
    barber: row.barber,
    barberConf: Number(row.barber_conf ?? 0),
    timeStart: row.time_start ? String(row.time_start).slice(0, 5) : null,
    timeEnd: row.time_end ? String(row.time_end).slice(0, 5) : null,
    session: (row.session ?? null) as MemoryRow["session"],
  };
}

function offeredTime(reply: string, avoid?: string): string | null {
  const flat = flatten(reply);
  for (const match of flat.matchAll(/às\s+(\d{1,2})h(\d{2})?/gi)) {
    const hhmm = `${match[1]!.padStart(2, "0")}:${match[2] ?? "00"}`;
    if (hhmm !== avoid) return `às ${match[1]}h${match[2] ?? ""}`;
  }
  return null;
}

function react(reply: string): string | null {
  const flat = flatten(reply);
  if (/essa confirma[cç][aã]o expirou/i.test(flat)) return null;
  if (/qual seu nome/i.test(flat)) return "Mateus";
  if (/vai ser o de sempre/i.test(flat)) return "sim";
  if (/quer que eu mude para/i.test(flat)) return "sim";
  if (/posso cancelar seu hor[aá]rio/i.test(flat)) return "sim";
  if (/posso confirmar\?/i.test(flat)) return "sim";
  if (/qual (deles|hor[aá]rio)|qual voc[eê] quer (cancelar|remarcar)/i.test(flat)) return null;
  const hour = offeredTime(flat);
  if (hour && /qual (fica melhor|prefere)/i.test(flat)) return hour;
  if (/qual servi[cç]o|corte ou barba|s[oó] o \*corte\*/i.test(flat)) return "corte";
  return null;
}

async function book(chat: Chat, opening: string): Promise<ApptRow> {
  const before = new Set((await listAppts(chat)).map((row) => row.id));
  let reply = await say(chat, opening);
  for (let i = 0; i < 8; i++) {
    const created = (await listAppts(chat)).find((row) => row.status !== "cancelled" && !before.has(row.id));
    if (created) return created;
    const next = react(reply);
    if (!next) throw new Error(`fluxo parou sem agendar: ${flatten(reply)}`);
    reply = await say(chat, next);
  }
  throw new Error(`não agendou. última fala: ${flatten(chat.replies.at(-1) ?? "")}`);
}

async function addVisit(chat: Chat, date: string, time: string, serviceName: string): Promise<string> {
  const client = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2
     LIMIT 1`,
    [chat.fx.barbershopId, chat.sandboxPhone],
  );
  const serviceId = serviceName.toLowerCase() === "barba" ? chat.fx.barbaId : chat.fx.corteId;
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 40, 10, 'pending') RETURNING id`,
    [chat.fx.barbershopId, client.rows[0]!.id, chat.fx.lucasId, serviceId, date, time],
  );
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 40, 30, $3, 0)`,
    [appt.rows[0]!.id, serviceId, serviceName],
  );
  return appt.rows[0]!.id;
}

async function closeVisit(id: string, date: string) {
  await pool.query(
    `UPDATE public.appointments SET status = 'completed', scheduled_date = $2::date WHERE id = $1`,
    [id, date],
  );
}

describe("contexto do cliente entre turnos e conversas", () => {
  const shops: ShopFx[] = [];

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres local indisponível — estes testes não podem passar sem o banco");
    }
    const { ensureCriticalSchema } = await import("../db/ensure-schema.js");
    await ensureCriticalSchema();
    useNoopWhatsAppOutbound();
  });

  afterEach(() => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
    useNoopWhatsAppOutbound();
  });

  afterAll(async () => {
    resetWhatsAppOutbound();
    for (const fx of shops) await wipe(fx);
  });

  async function shop(suffix: string, hours?: Hours): Promise<ShopFx> {
    const fx = await seedShop(suffix, hours);
    shops.push(fx);
    return fx;
  }

  it("1. cliente novo agenda e, dias depois, ouve o de sempre e o barbeiro", async () => {
    const fx = await shop("c1");
    const chat = await openChat(fx, "5511900001001", DAY);
    const created = await book(chat, "quero corte amanhã às 15h com o Lucas");
    expect(created.service).toMatch(/Corte/i);
    expect(created.barber).toBe("Lucas");
    expect(created.time).toBe("15:00");
    expect(chat.tools.some((names) => names.includes("create_appointment"))).toBe(true);
    expect(chat.tools.some((names) => names.includes("check_availability"))).toBe(true);

    const memory = await loadMemory(chat);
    expect(memory?.services.join(" ")).toMatch(/Corte/i);
    expect(memory?.barber).toBe("Lucas");
    expect(memory?.barberConf ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(memory?.timeStart).toBe("13:00");
    expect(memory?.timeEnd).toBe("18:00");
    expect(memory?.session?.bookingDraft).toBeTruthy();

    await fresh(chat, "2026-11-20T11:00:00-03:00");
    const suggestion = await say(chat, "quero agendar");
    expect(flatten(suggestion)).toMatch(/Vai ser o de sempre, \*Corte\*, com o Lucas\?/i);
    const again = await loadMemory(chat);
    expect(again?.services.join(" ")).toMatch(/Corte/i);
    expect(again?.barber).toBe("Lucas");
  }, 60_000);

  it("2. outra conversa remarca o mesmo agendamento, com card de mudança", async () => {
    const fx = await shop("c2");
    const chat = await openChat(fx, "5511900001002", DAY);
    const created = await book(chat, "quero corte amanhã às 15h com o Lucas");

    await fresh(chat, "2026-11-16T14:00:00-03:00");
    const card = await say(chat, "quero mudar meu horário para as 16h");
    expect(flatten(card)).toMatch(/Quer que eu mude para/i);
    expect(flatten(card)).not.toMatch(/Posso confirmar\?/i);
    expect(chat.tools.at(-1) ?? []).toContain("check_availability");
    expect(chat.tools.at(-1) ?? []).not.toContain("reschedule_appointment");
    expect(chat.tools.at(-1) ?? []).not.toContain("create_appointment");

    const done = await say(chat, "sim");
    expect(chat.tools.at(-1) ?? []).toContain("reschedule_appointment");
    expect(chat.tools.at(-1) ?? []).not.toContain("create_appointment");
    expect(flatten(done).length).toBeGreaterThan(0);

    const rows = await listAppts(chat);
    const live = rows.filter((row) => row.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(created.id);
    expect(live[0]!.time).toBe("16:00");
    expect(live[0]!.date).toBe(created.date);
  }, 60_000);

  it("3. lembrete, confirmo, cancelo com card e o cancelado some na conversa seguinte", async () => {
    const fx = await shop("c3");
    const chat = await openChat(fx, "5511900001003", DAY);
    const created = await book(chat, "quero corte amanhã às 15h com o Lucas");
    expect(created.date).toBe("2026-11-17");

    const reminder = await remind(chat, EVENING);
    expect(reminder).toMatch(/confirma/i);
    const confirmed = await say(chat, "confirmo");
    expect(chat.tools.at(-1) ?? []).toContain("confirm_appointment");
    expect(flatten(confirmed)).toMatch(/Presença confirmada/i);
    const afterRsvp = await listAppts(chat);
    expect(afterRsvp.find((row) => row.id === created.id)?.status).toBe("confirmed");

    await fresh(chat, "2026-11-16T19:00:00-03:00");
    const cancelCard = await say(chat, "preciso cancelar");
    expect(flatten(cancelCard)).toMatch(/Posso cancelar seu hor[aá]rio/i);
    expect(chat.tools.at(-1) ?? []).not.toContain("cancel_appointment");
    const cancelled = await say(chat, "sim");
    expect(chat.tools.at(-1) ?? []).toContain("cancel_appointment");
    expect((await listAppts(chat)).find((row) => row.id === created.id)?.status).toBe("cancelled");

    await fresh(chat, "2026-11-16T19:10:00-03:00");
    const later = await say(chat, "preciso cancelar");
    expect(flatten(later)).toMatch(/não tem horário marcado agora/i);
    const still = await listAppts(chat);
    expect(still.filter((row) => row.status !== "cancelled")).toHaveLength(0);
  }, 60_000);

  it("4. depois do lembrete, mudar oferece horários e o sim remarca", async () => {
    const fx = await shop("c4");
    const chat = await openChat(fx, "5511900001004", DAY);
    const created = await book(chat, "quero corte amanhã às 15h com o Lucas");
    await remind(chat, EVENING);

    const offer = await say(chat, "dá pra mudar?");
    expect(chat.tools.at(-1) ?? []).toContain("get_next_slots");
    const choice = offeredTime(offer, "15:00");
    expect(choice).toBeTruthy();
    const hours = [...flatten(offer).matchAll(/às\s+\d{1,2}h\d{0,2}/gi)];
    expect(hours.length, flatten(offer)).toBeGreaterThanOrEqual(2);
    expect(hours.length).toBeLessThanOrEqual(3);

    const card = await say(chat, choice!);
    expect(flatten(card)).toMatch(/Quer que eu mude para/i);
    expect(flatten(card)).not.toMatch(/Posso confirmar\?/i);
    await say(chat, "sim");
    expect(chat.tools.at(-1) ?? []).toContain("reschedule_appointment");

    const rows = await listAppts(chat);
    const live = rows.filter((row) => row.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(created.id);
    expect(live[0]!.time).not.toBe("15:00");
  }, 60_000);

  it("5. dois horários: cancela um e, na conversa seguinte, remarca o outro", async () => {
    const fx = await shop("c5");
    const chat = await openChat(fx, "5511900001005", DAY);
    const first = await book(chat, "quero corte amanhã às 15h com o Lucas");
    const secondId = await addVisit(chat, "2026-11-18", "11:00", "Corte");
    const second = (await listAppts(chat)).find((row) => row.id === secondId);
    if (!second) throw new Error("segunda visita não gravou");
    expect(first.date).not.toBe(second.date);

    await fresh(chat, "2026-11-17T09:30:00-03:00");
    let reply = await say(chat, "preciso cancelar o das 15h");
    if (!/posso cancelar/i.test(flatten(reply))) {
      reply = await say(chat, "o das 15h");
    }
    expect(flatten(reply)).toMatch(/Posso cancelar seu hor[aá]rio/i);
    expect(flatten(reply)).toMatch(/15h/);
    await say(chat, "sim");
    const mid = await listAppts(chat);
    expect(mid.find((row) => row.id === first.id)?.status).toBe("cancelled");
    expect(mid.find((row) => row.id === second.id)?.status).not.toBe("cancelled");

    await fresh(chat, "2026-11-17T10:00:00-03:00");
    const card = await say(chat, "quero mudar meu horário para as 16h");
    expect(flatten(card)).toMatch(/Quer que eu mude para/i);
    expect(flatten(card)).toMatch(/11h/);
    await say(chat, "sim");
    const end = await listAppts(chat);
    const moved = end.find((row) => row.id === second.id);
    expect(moved?.status).not.toBe("cancelled");
    expect(moved?.time).toBe("16:00");
    expect(end.find((row) => row.id === first.id)?.status).toBe("cancelled");
    expect(end.filter((row) => row.status !== "cancelled")).toHaveLength(1);
  }, 90_000);

  it("6. o serviço de costume muda depois de várias visitas concluídas", async () => {
    const fx = await shop("c6");
    const chat = await openChat(fx, "5511900001006", "2026-10-01T10:00:00-03:00");
    const visits = [
      ["2026-10-01T10:00:00-03:00", "2026-10-02", "barba"],
      ["2026-10-08T10:00:00-03:00", "2026-10-09", "barba"],
      ["2026-10-15T10:00:00-03:00", "2026-10-16", "barba"],
      ["2026-11-01T10:00:00-03:00", "2026-11-02", "corte"],
    ] as const;
    for (const [now, pastDate, service] of visits) {
      await fresh(chat, now);
      const row = await book(chat, `quero ${service} amanhã às 15h com o Lucas`);
      await closeVisit(row.id, pastDate);
    }
    const memoryBefore = await loadMemory(chat);
    expect(memoryBefore?.services.join(" ")).toMatch(/Corte/i);

    await fresh(chat, "2026-12-02T10:00:00-03:00");
    const suggestion = await say(chat, "quero agendar");
    expect(flatten(suggestion)).toMatch(/Vai ser o de sempre, \*Barba\*/i);
    expect(flatten(suggestion)).toMatch(/Lucas/);
  }, 90_000);

  it("7. sim atrasado em conversa nova não executa o card vencido", async () => {
    const fx = await shop("c7");
    const chat = await openChat(fx, "5511900001007", DAY);
    const card = await say(chat, "quero corte amanhã às 15h com o Lucas");
    expect(flatten(card)).toMatch(/Posso confirmar\?/i);
    expect(await listAppts(chat)).toHaveLength(0);
    const pending = await loadMemory(chat);
    expect(pending?.session?.bookingDraft?.confirmCard?.kind).toBe("create");

    await fresh(chat, "2026-11-16T10:40:00-03:00");
    const late = await say(chat, "sim");
    expect(flatten(late)).toMatch(/Essa confirmação expirou/i);
    expect(chat.tools.at(-1) ?? []).not.toContain("create_appointment");
    expect(await listAppts(chat)).toHaveLength(0);
  }, 60_000);

  it("7b. card dentro do TTL, em conversa nova, reapresenta e não aceita o sim direto", async () => {
    const fx = await shop("c7b");
    const chat = await openChat(fx, "5511900001072", DAY);
    const card = await say(chat, "quero corte amanhã às 15h com o Lucas");
    expect(flatten(card)).toMatch(/Posso confirmar\?/i);
    expect(await listAppts(chat)).toHaveLength(0);

    await fresh(chat, "2026-11-16T10:10:00-03:00");
    const again = await say(chat, "sim");
    expect(flatten(again)).toMatch(/Posso confirmar\?/i);
    expect(flatten(again)).toMatch(/15h/);
    expect(chat.tools.at(-1) ?? []).not.toContain("create_appointment");
    expect(await listAppts(chat)).toHaveLength(0);

    let reply = again;
    for (let i = 0; i < 6 && (await listAppts(chat)).length === 0; i++) {
      const next = react(reply);
      if (!next) throw new Error(`não reapresentou o card: ${flatten(reply)}`);
      reply = await say(chat, next);
    }
    const booked = await listAppts(chat);
    expect(booked).toHaveLength(1);
    expect(booked[0]?.time).toBe("15:00");
    expect(booked[0]?.date).toBe("2026-11-17");
  }, 60_000);

  it("7c. card de slot ocupado não volta vivo na conversa nova", async () => {
    const fx = await shop("c7c");
    const chat = await openChat(fx, "5511900001073", DAY);
    const card = await say(chat, "quero corte amanhã às 15h com o Lucas");
    expect(flatten(card)).toMatch(/Posso confirmar\?/i);

    const other = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Outro', '5511900001999') RETURNING id`,
      [fx.barbershopId],
    );
    await pool.query(
      `INSERT INTO public.appointments
         (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       VALUES ($1, $2, $3, $4, '2026-11-17'::date, '15:00'::time, 30, 40, 10, 'pending')`,
      [fx.barbershopId, other.rows[0]!.id, fx.lucasId, fx.corteId],
    );

    await fresh(chat, "2026-11-16T10:10:00-03:00");
    const again = await say(chat, "sim");
    const flat = flatten(again);
    expect(chat.tools.at(-1) ?? []).not.toContain("create_appointment");
    expect(await listAppts(chat)).toHaveLength(0);
    if (/posso confirmar\?/i.test(flat)) expect(flat).not.toMatch(/15h/);
  }, 60_000);

  it("8. dois clientes no mesmo tenant e o mesmo telefone em outro tenant não vazam", async () => {
    const shopA = await shop("c8a");
    const shopB = await shop("c8b");
    const shared = "5511900001888";
    const other = "5511900001889";

    const a1 = await openChat(shopA, shared, DAY);
    await book(a1, "quero corte amanhã às 15h com o Lucas");
    const a2 = await openChat(shopA, other, DAY);
    await book(a2, "quero barba amanhã às 11h com o Eduardo");
    const b1 = await openChat(shopB, shared, DAY);
    await book(b1, "quero barba amanhã às 16h com o Eduardo");

    await fresh(a1, "2026-11-20T11:00:00-03:00");
    const backA = await say(a1, "quero agendar");
    expect(flatten(backA)).toMatch(/\*Corte\*/);
    expect(flatten(backA)).toMatch(/Lucas/);
    expect(flatten(backA)).not.toMatch(/\*Barba\*/);
    expect(flatten(backA)).not.toMatch(/Eduardo/);

    await fresh(a2, "2026-11-20T11:00:00-03:00");
    const backOther = await say(a2, "quero agendar");
    expect(flatten(backOther)).toMatch(/\*Barba\*/);
    expect(flatten(backOther)).toMatch(/Eduardo/);
    expect(flatten(backOther)).not.toMatch(/\*Corte\*/);

    await fresh(b1, "2026-11-20T11:00:00-03:00");
    const backB = await say(b1, "quero agendar");
    expect(flatten(backB)).toMatch(/\*Barba\*/);
    expect(flatten(backB)).toMatch(/Eduardo/);
    expect(flatten(backB)).not.toMatch(/\*Corte\*/);
    expect(flatten(backB)).not.toMatch(/Lucas/);

    const memA = await loadMemory(a1);
    const memB = await loadMemory(b1);
    expect(memA?.services.join(" ")).toMatch(/Corte/i);
    expect(memB?.services.join(" ")).toMatch(/Barba/i);
    expect(a1.sandboxPhone).not.toBe(b1.sandboxPhone);
  }, 90_000);

  it("9. fora do horário oferece o dia seguinte sem trocar amanhã pelo nome do dia", async () => {
    const fx = await shop("c9", OPEN_UNTIL_18);
    const chat = await openChat(fx, "5511900001009", AFTER_CLOSE);
    const reply = await say(chat, "quero corte");
    const flat = flatten(reply);
    expect(flat).toContain(CLOSING_TODAY_THEN_TOMORROW);
    expect(flat).toMatch(/amanhã/i);
    expect(flat).not.toMatch(/\b(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)\b/i);
    expect(chat.tools.at(-1) ?? []).toContain("get_next_slots");
    expect([...flat.matchAll(/às\s+\d{1,2}h/gi)].length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("10. você é robô no meio do fluxo desvia e segue o horário", async () => {
    const fx = await shop("c10");
    const chat = await openChat(fx, "5511900001010", DAY);
    const opening = await say(chat, "quero corte");
    expect(flatten(opening)).toMatch(/qual (fica melhor|prefere)|às\s+\d{1,2}h/i);
    const aside = await say(chat, "você é robô?");
    const flat = flatten(aside);
    expect(flat).toMatch(/Estou aqui pra te ajudar com o horário/);
    expect(flat).toMatch(/qual (fica melhor|prefere)|às\s+\d{1,2}h|Quer agendar, reagendar ou ver um horário/);
    expect(flat).not.toMatch(/posso confirmar\?/i);
    const next = offeredTime(aside) ?? "às 15h";
    const card = await say(chat, next);
    expect(flatten(card)).toMatch(/Posso confirmar\?|qual seu nome/i);
  }, 60_000);

  it("11. trocar esse horário, dito de outro jeito, também remarca o mesmo", async () => {
    const fx = await shop("c11");
    const chat = await openChat(fx, "5511900001011", DAY);
    const created = await book(chat, "quero corte amanhã às 15h com o Lucas");
    await fresh(chat, "2026-11-16T15:00:00-03:00");
    const card = await say(chat, "consegue trocar esse horário para as 17h?");
    expect(flatten(card)).toMatch(/Quer que eu mude para/i);
    await say(chat, "sim");
    const live = (await listAppts(chat)).filter((row) => row.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(created.id);
    expect(live[0]!.time).toBe("17:00");
  }, 60_000);

  it("12. o rascunho continua no turno seguinte da mesma conversa", async () => {
    const fx = await shop("c12");
    const chat = await openChat(fx, "5511900001012", DAY);
    const offer = await say(chat, "quero corte amanhã");
    expect(flatten(offer)).toMatch(/amanhã/i);
    expect(flatten(offer)).not.toMatch(/qual servi[cç]o/i);
    const picked = offeredTime(offer);
    expect(picked).toBeTruthy();
    const card = await say(chat, picked!);
    expect(flatten(card)).toMatch(/Posso confirmar\?|qual seu nome/i);
    expect(flatten(card)).not.toMatch(/qual servi[cç]o/i);
    expect(flatten(card)).toMatch(/Corte/i);
    const memory = await loadMemory(chat);
    expect(memory?.session?.bookingDraft?.status === "offered" || memory?.session?.bookingDraft?.status === "awaiting_name").toBe(
      true,
    );
  }, 60_000);

  it("13. remarca, inclui serviço e paga: nada de dia passado, serviço gravado e PIX do valor gravado", async () => {
    const fx = await shop("c13");
    await pool.query(`UPDATE public.barbershops SET pix_key = 'pix@navalhia.test', pix_key_type = 'email' WHERE id = $1`, [
      fx.barbershopId,
    ]);
    const barbaCompleta = await pool.query<{ id: string }>(
      `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active, category)
       VALUES ($1, 'Barba completa', 25, 30, true, 'barba') RETURNING id`,
      [fx.barbershopId],
    );
    const combo = await pool.query<{ id: string }>(
      `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active, category)
       VALUES ($1, 'Corte e Barba', 85, 60, true, 'combo') RETURNING id`,
      [fx.barbershopId],
    );
    const comboId = combo.rows[0]!.id;
    const now = "2026-11-17T10:24:00-03:00";
    const chat = await openChat(fx, "5511900001013", now);
    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Mateus Manoel', $2) RETURNING id`,
      [fx.barbershopId, chat.sandboxPhone],
    );
    const appt = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments
         (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       VALUES ($1, $2, $3, $4, '2026-11-17'::date, '10:30'::time, 30, 25, 10, 'pending') RETURNING id`,
      [fx.barbershopId, client.rows[0]!.id, fx.eduardoId, barbaCompleta.rows[0]!.id],
    );
    const apptId = appt.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
       VALUES ($1, $2, 25, 30, 'Barba completa', 0)`,
      [apptId, barbaCompleta.rows[0]!.id],
    );
    // Rascunho de uma conversa anterior com um dia que já passou (como o sábado 14/11 do teste real).
    const { saveClientSessionContext } = await import("../ai/agent/client-session-context.js");
    const { emptyPendingIntents } = await import("../ai/agent/pending-intents.js");
    const { parseBookingDraft } = await import("../ai/booking-draft.js");
    await saveClientSessionContext({
      barbershopId: fx.barbershopId,
      clientPhone: chat.sandboxPhone,
      bookingDraft: parseBookingDraft({
        status: "collecting",
        date: "2026-11-14",
        time: "10:30",
        service_ids: [barbaCompleta.rows[0]!.id],
        service_name: "Barba completa",
        barber_id: fx.eduardoId,
        barber_name: "Eduardo",
        appointment_id: apptId,
      }),
      pendingIntents: emptyPendingIntents(),
      lastIntent: "reschedule",
      updatedAt: "2026-11-17T09:30:00-03:00",
    });
    await fresh(chat, now);

    const pastDay = /s[aá]bado|14\/11/i;

    // Não dá no horário marcado: o agente oferece outros horários do mesmo barbeiro, não um card para 10h30.
    const offer = await say(chat, "Bom dia, não vou conseguir chegar às 10h30, teria outro horário?");
    expect(flatten(offer)).not.toMatch(pastDay);
    expect(chat.tools.at(-1) ?? []).not.toContain("reschedule_appointment");
    expect(flatten(offer)).not.toMatch(/mude para hoje às 10h30/i);
    expect([...flatten(offer).matchAll(/às\s+\d{1,2}h/gi)].length).toBeGreaterThanOrEqual(2);
    const offerSession = (await loadMemory(chat))?.session?.bookingDraft as { date?: string; time?: string | null };
    expect(offerSession?.date).toBe("2026-11-17");
    expect(offerSession?.time ?? null).toBeNull();

    // Hora nomeada: card de remarcação do mesmo agendamento, com check antes e nada gravado.
    const card = await say(chat, "e às 15h hoje, tem?");
    expect(chat.tools.at(-1) ?? []).toContain("check_availability");
    expect(chat.tools.at(-1) ?? []).not.toContain("reschedule_appointment");
    expect(flatten(card)).toMatch(/Quer que eu mude para/i);
    expect(flatten(card)).not.toMatch(pastDay);
    expect((await listAppts(chat))[0]!.time).toBe("10:30");

    await say(chat, "pode ser, perfeito");
    let live = (await listAppts(chat)).filter((row) => row.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: apptId, date: "2026-11-17", time: "15:00", service: "Barba completa", barber: "Eduardo" });

    // Inclui o corte no mesmo horário: card com o serviço novo, checado com a duração do combo, nada gravado ainda.
    const change = await say(chat, "quero fazer corte e barba");
    expect(chat.tools.at(-1) ?? []).toContain("check_availability");
    expect(chat.tools.at(-1) ?? []).not.toContain("reschedule_appointment");
    expect(flatten(change)).toMatch(/Corte e Barba/);
    live = (await listAppts(chat)).filter((row) => row.status !== "cancelled");
    expect(live[0]!.service).toBe("Barba completa");

    // Emenda o horário (meio dia) e depois aceita repetindo o card: grava combo às 12h no mesmo agendamento.
    const amended = await say(chat, "Show! Mas se der ao meio dia é melhor, consegue?");
    expect(chat.tools.at(-1) ?? []).toContain("check_availability");
    expect(flatten(amended)).toMatch(/12h/);
    expect(flatten(amended)).toMatch(/Corte e Barba/);
    await say(chat, "Isso, corte e barba hoje ao meio dia");
    expect(chat.tools.at(-1) ?? []).toContain("reschedule_appointment");
    live = (await listAppts(chat)).filter((row) => row.status !== "cancelled");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: apptId, date: "2026-11-17", time: "12:00", service: "Corte e Barba" });
    const stored = await pool.query<{ service_id: string; price: string; duration_minutes: number }>(
      `SELECT service_id, price::text, duration_minutes FROM public.appointments WHERE id = $1`,
      [apptId],
    );
    expect(stored.rows[0]).toMatchObject({ service_id: comboId, duration_minutes: 60 });
    expect(Number(stored.rows[0]!.price)).toBe(85);

    // PIX cobra o que está gravado.
    const pix = await say(chat, "me passa o pix por favor");
    expect(chat.tools.at(-1) ?? []).toContain("send_shop_pix");
    expect(flatten(pix)).toMatch(/85,00/);
    expect(flatten(pix)).not.toMatch(/25,00/);
  }, 90_000);
});
