/**
 * Regression: "Pode ser o próximo" after "Qual horário você prefere?" must offer
 * 2–3 concrete slots (or the agreed closing-today copy) — never stay silent and
 * never only re-ask "Qual hora você prefere?".
 *
 * These tests require the local Postgres (127.0.0.1:55432). They fail hard if
 * the database is down; they must not skip and pass.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { pool } from "../db.js";
import { runAgent, ROBOT_QUESTION_DEFLECT, ROBOT_QUESTION_CONTINUE } from "../ai/agent.js";
import * as aiTools from "../ai/tools.js";
import {
  CLOSING_TODAY_THEN_TOMORROW,
  NEXT_SLOTS_UNAVAILABLE_SAFE,
  parseBookingDraft,
} from "../ai/booking-draft.js";
import type OpenAI from "openai";

const SLUG_PREFIX = "test-next-slot-";
const WEEKDAY_NAME_RE = /segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo/i;
const OPEN_WEEK = {
  monday: { start: "09:00", end: "20:00" },
  tuesday: { start: "09:00", end: "20:00" },
  wednesday: { start: "09:00", end: "20:00" },
  thursday: { start: "09:00", end: "20:00" },
  friday: { start: "09:00", end: "20:00" },
  saturday: { start: "09:00", end: "20:00" },
  sunday: { start: "09:00", end: "20:00" },
};

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** If the deterministic path is missed, fail with a clear error instead of a canned LLM reply. */
function stubOpenAIMustNotBeCalled(): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error("fell through to the LLM — expected a deterministic next-slot offer");
        },
      },
    },
  } as unknown as OpenAI;
}

type ShopFx = {
  barbershopId: string;
  conversationId: string;
  clientPhone: string;
  serviceId: string;
  barberId: string;
  todayIso: string;
  tomorrowIso: string;
};

async function seedShop(params: {
  suffix: string;
  phone: string;
  hours: Record<string, { start: string; end: string }>;
  draftDate: "today" | "tomorrow";
  draftServices?: boolean;
  afterTime?: string;
  offeredTimes?: string[];
  durationMinutes?: number;
  draftTime?: string;
}): Promise<ShopFx> {
  const slug = `${SLUG_PREFIX}${params.suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const todayRow = await pool.query<{ d: string; t: string }>(
    `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
  );
  const todayIso = todayRow.rows[0]!.d;
  const tomorrowIso = todayRow.rows[0]!.t;
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, $2, 'pro', $3, $4::jsonb) RETURNING id`,
    [`Test next slot ${slug}`, params.phone, slug, JSON.stringify(params.hours)],
  );
  const barbershopId = shop.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
     ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
    [barbershopId],
  );
  const barber = await pool.query<{ id: string }>(
    `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Lucas', 'active') RETURNING id`,
    [barbershopId],
  );
  const barberId = barber.rows[0]!.id;
  const service = await pool.query<{ id: string }>(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
     VALUES ($1, 'Corte', 40, $2, true) RETURNING id`,
    [barbershopId, params.durationMinutes ?? 30],
  );
  const serviceId = service.rows[0]!.id;
  const conv = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
     VALUES ($1, 'whatsapp', $2) RETURNING id`,
    [barbershopId, params.phone],
  );
  const conversationId = conv.rows[0]!.id;
  const rows = [
    { role: "user", content: "Olá, tudo bem?" },
    {
      role: "assistant",
      content:
        "Olá! Bem-vindo à Cavalier Barbearia! Quer ver os serviços disponíveis ou já prefere agendar um horário?",
    },
    { role: "user", content: "Quero agendar um corte pra hoje" },
    { role: "assistant", content: "Seria o corte simples ou o combo?" },
    { role: "user", content: "Só o corte mesmo" },
    { role: "assistant", content: "Qual horário você prefere para o corte?" },
  ];
  for (const r of rows) {
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [conversationId, r.role, r.content],
    );
  }
  const dateIso = params.draftDate === "tomorrow" ? tomorrowIso : todayIso;
  const draft =
    params.draftServices === false
      ? { status: "collecting", date: dateIso }
      : {
          status: "collecting",
          service_ids: [serviceId],
          service_name: "Corte",
          barber_id: barberId,
          barber_name: "Lucas",
          date: dateIso,
          lastAgentQuestion: "datetime",
          ...(params.afterTime ? { after_time: params.afterTime } : {}),
          ...(params.offeredTimes ? { offeredTimes: params.offeredTimes } : {}),
          ...(params.draftTime ? { time: params.draftTime } : {}),
        };
  await pool.query(
    `INSERT INTO public.ai_conversation_runtime (conversation_id, booking_draft, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (conversation_id) DO UPDATE SET booking_draft = $2::jsonb, updated_at = now()`,
    [conversationId, JSON.stringify(draft)],
  );
  return {
    barbershopId,
    conversationId,
    clientPhone: params.phone,
    serviceId,
    barberId,
    todayIso,
    tomorrowIso,
  };
}

async function insertUpcoming(fx: ShopFx, time = "10:00"): Promise<string> {
  const client = await pool.query<{ id: string }>(
    `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Mateus', $2) RETURNING id`,
    [fx.barbershopId, fx.clientPhone],
  );
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, $6, 30, 40, 10, 'pending')
     RETURNING id`,
    [fx.barbershopId, client.rows[0]!.id, fx.barberId, fx.serviceId, fx.tomorrowIso, time],
  );
  const appointmentId = appt.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 40, 30, 'Corte', 0)`,
    [appointmentId, fx.serviceId],
  );
  return appointmentId;
}

async function loadDraft(conversationId: string) {
  const row = await pool.query<{ booking_draft: unknown }>(
    `SELECT booking_draft FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
    [conversationId],
  );
  return parseBookingDraft(row.rows[0]?.booking_draft);
}

async function toolPayloads(conversationId: string, toolName: string): Promise<Array<Record<string, unknown>>> {
  const rows = await pool.query<{ tool_payload: unknown }>(
    `SELECT tool_payload FROM public.ai_messages WHERE conversation_id = $1 AND tool_name = $2`,
    [conversationId, toolName],
  );
  return rows.rows
    .map((r) => r.tool_payload)
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object");
}

async function runUser(fx: ShopFx, text: string) {
  await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
    fx.conversationId,
    text,
  ]);
  return runAgent(fx.barbershopId, fx.conversationId, fx.clientPhone, stubOpenAIMustNotBeCalled(), {
    persistAssistantMessages: false,
  });
}

async function wipe(fx: ShopFx | null) {
  if (!fx?.barbershopId) return;
  await pool.query(
    `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1)`,
    [fx.barbershopId],
  );
  await pool.query(`DELETE FROM public.appointments WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.ai_conversations WHERE id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [fx.barbershopId]);
}

async function closeTodayHours(fx: ShopFx) {
  const dow = await pool.query<{ k: string }>(
    `SELECT trim(to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'day')) AS k`,
  );
  const raw = (dow.rows[0]?.k ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    monday: "monday",
    tuesday: "tuesday",
    wednesday: "wednesday",
    thursday: "thursday",
    friday: "friday",
    saturday: "saturday",
    sunday: "sunday",
  };
  const pt: Record<string, string> = {
    "segunda-feira": "monday",
    terça: "tuesday",
    "terça-feira": "tuesday",
    "terca-feira": "tuesday",
    "quarta-feira": "wednesday",
    "quinta-feira": "thursday",
    "sexta-feira": "friday",
    sábado: "saturday",
    sabado: "saturday",
    domingo: "sunday",
  };
  const key = map[raw] ?? pt[raw] ?? raw;
  const hours = { ...OPEN_WEEK, [key]: { start: "09:00", end: "09:30" } };
  await pool.query(`UPDATE public.barbershops SET business_hours = $2::jsonb WHERE id = $1`, [
    fx.barbershopId,
    JSON.stringify(hours),
  ]);
}

describe("agente — 'Pode ser o próximo' oferece horários concretos", () => {
  const shops: ShopFx[] = [];
  let openFx: ShopFx;
  let closedFx: ShopFx;
  let thinFx: ShopFx;
  let afterFx: ShopFx;
  let fitFx: ShopFx;
  let askHourFx: ShopFx;
  let loopFx: ShopFx;
  let cancelFx: ShopFx;
  let rescheduleFx: ShopFx;
  let keepNewFx: ShopFx;
  let toolFx: ShopFx;
  let robotFx: ShopFx;
  let robotBareFx: ShopFx;
  let shopA: ShopFx;
  let shopB: ShopFx;

  beforeAll(async () => {
    const ok = await dbAvailable();
    if (!ok) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    openFx = await seedShop({ suffix: "open", phone: "5511988800701", hours: OPEN_WEEK, draftDate: "tomorrow" });
    thinFx = await seedShop({
      suffix: "thin",
      phone: "5511988800703",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
      draftServices: false,
    });
    closedFx = await seedShop({ suffix: "closed", phone: "5511988800702", hours: OPEN_WEEK, draftDate: "today" });
    await closeTodayHours(closedFx);
    afterFx = await seedShop({
      suffix: "after",
      phone: "5511988800704",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
      afterTime: "16:00",
    });
    fitFx = await seedShop({
      suffix: "fit",
      phone: "5511988800705",
      hours: OPEN_WEEK,
      draftDate: "today",
      afterTime: "18:00",
      durationMinutes: 180,
    });
    askHourFx = await seedShop({ suffix: "askhour", phone: "5511988800706", hours: OPEN_WEEK, draftDate: "tomorrow" });
    loopFx = await seedShop({
      suffix: "loop",
      phone: "5511988800707",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
      offeredTimes: ["14:00", "14:30", "15:00"],
    });
    cancelFx = await seedShop({ suffix: "cancel", phone: "5511988800708", hours: OPEN_WEEK, draftDate: "tomorrow" });
    rescheduleFx = await seedShop({
      suffix: "resched",
      phone: "5511988800709",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
    });
    keepNewFx = await seedShop({ suffix: "keepnew", phone: "5511988800710", hours: OPEN_WEEK, draftDate: "tomorrow" });
    toolFx = await seedShop({ suffix: "toolerr", phone: "5511988800711", hours: OPEN_WEEK, draftDate: "tomorrow" });
    robotFx = await seedShop({ suffix: "robot", phone: "5511988800712", hours: OPEN_WEEK, draftDate: "tomorrow" });
    robotBareFx = await seedShop({
      suffix: "robotbare",
      phone: "5511988800713",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
      draftServices: false,
    });
    shopA = await seedShop({ suffix: "tenanta", phone: "5511988800714", hours: OPEN_WEEK, draftDate: "tomorrow" });
    shopB = await seedShop({ suffix: "tenantb", phone: "5511988800715", hours: OPEN_WEEK, draftDate: "tomorrow" });
    shops.push(
      openFx,
      closedFx,
      thinFx,
      afterFx,
      fitFx,
      askHourFx,
      loopFx,
      cancelFx,
      rescheduleFx,
      keepNewFx,
      toolFx,
      robotFx,
      robotBareFx,
      shopA,
      shopB,
    );
  });

  afterAll(async () => {
    for (const fx of shops) await wipe(fx);
  });

  it("com vaga no dia do rascunho, oferece 2–3 horários e não fica em silêncio", async () => {
    const result = await runUser(openFx, "Pode ser o próximo");
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(result.reply).toMatch(/Consigo te atender/i);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    expect(result.turnTrace?.silencedBy).toBeFalsy();
    const usedTool = result.turnTrace?.toolsExecuted?.some((t) => t.name === "get_next_slots" && t.ok);
    expect(usedTool).toBe(true);
    const draft = await loadDraft(openFx.conversationId);
    expect(draft.offeredTimes?.length).toBeGreaterThanOrEqual(2);
    expect(draft.time).toBeUndefined();
  });

  it("perto do fechamento, usa a fala genérica e oferece 2–3 horários do próximo dia sem nomear o dia", async () => {
    const result = await runUser(closedFx, "Pode ser o próximo");
    expect(result.reply).toContain(CLOSING_TODAY_THEN_TOMORROW);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    expect(result.reply).not.toMatch(WEEKDAY_NAME_RE);
    expect(result.reply.trim().length).toBeGreaterThan(0);
  });

  it("mesmo com o rascunho só com a data, recupera 'Só o corte mesmo' e oferece horários", async () => {
    const result = await runUser(thinFx, "Pode ser o próximo");
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(result.reply).toMatch(/Consigo te atender/i);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    expect(result.reply).not.toMatch(/simples ou o combo/);
    expect(result.turnTrace?.silencedBy).toBeFalsy();
  });

  it("respeita after_time como piso e não oferece horário já passado nesse piso", async () => {
    const result = await runUser(afterFx, "Pode ser o próximo");
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    const draft = await loadDraft(afterFx.conversationId);
    expect(draft.after_time).toBe("16:00");
    expect(draft.time).toBeUndefined();
    for (const time of draft.offeredTimes ?? []) {
      expect(time >= "16:00").toBe(true);
    }
    const payloads = await toolPayloads(afterFx.conversationId, "get_next_slots");
    expect(payloads.some((p) => p.after_time === "16:00")).toBe(true);
  });

  it("quando o serviço não cabe antes do fechamento, rola o dia com a fala genérica e sem nomear o dia", async () => {
    const result = await runUser(fitFx, "Pode ser o próximo");
    expect(result.reply).toContain(CLOSING_TODAY_THEN_TOMORROW);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(WEEKDAY_NAME_RE);
    const draft = await loadDraft(fitFx.conversationId);
    expect(draft.date).toBe(fitFx.tomorrowIso);
  });

  it("sem relógio nomeado, oferece 2–3 horários no lugar de «Qual hora você prefere?»", async () => {
    const result = await runUser(askHourFx, "sim");
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    const draft = await loadDraft(askHourFx.conversationId);
    expect((draft.offeredTimes ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("«o mais cedo» depois da oferta trava o primeiro horário e não refaz a busca", async () => {
    const result = await runUser(loopFx, "o mais cedo");
    expect(result.reply).toMatch(/Posso confirmar\?/);
    expect(result.reply).toMatch(/14h/);
    expect(result.turnTrace?.toolsExecuted?.some((t) => t.name === "check_availability")).toBe(true);
    const draft = await loadDraft(loopFx.conversationId);
    expect(draft.time).toBe("14:00");
    expect(draft.offeredTimes).toBeUndefined();
  });

  it("«quero cancelar o próximo» cancela de verdade e não oferece vaga", async () => {
    const appointmentId = await insertUpcoming(cancelFx, "10:00");
    const result = await runUser(cancelFx, "quero cancelar o próximo");
    expect(result.reply).toMatch(/cancelado/i);
    expect(result.reply).not.toMatch(/Consigo te atender/i);
    expect(result.turnTrace?.toolsExecuted?.some((t) => t.name === "get_next_slots")).toBeFalsy();
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("cancelled");
  });

  it("«quero reagendar, pode ser o próximo» mantém serviço, barbeiro e exclude_appointment_id", async () => {
    const appointmentId = await insertUpcoming(rescheduleFx, "10:00");
    const result = await runUser(rescheduleFx, "quero reagendar, pode ser o próximo");
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/cancelado/i);
    const payloads = await toolPayloads(rescheduleFx.conversationId, "get_next_slots");
    expect(payloads.some((p) => p.exclude_appointment_id === appointmentId)).toBe(true);
    const draft = await loadDraft(rescheduleFx.conversationId);
    expect(draft.appointment_id).toBe(appointmentId);
    expect(draft.service_ids).toEqual([rescheduleFx.serviceId]);
    expect(draft.barber_id).toBe(rescheduleFx.barberId);
    const still = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(still.rows[0]?.status).toBe("pending");
  });

  it("agendamento novo com um horário já marcado não trata «o próximo» como reagendar", async () => {
    const appointmentId = await insertUpcoming(keepNewFx, "10:00");
    const result = await runUser(keepNewFx, "Pode ser o próximo");
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    const payloads = await toolPayloads(keepNewFx.conversationId, "get_next_slots");
    expect(payloads.some((p) => p.exclude_appointment_id === appointmentId)).toBe(false);
    const draft = await loadDraft(keepNewFx.conversationId);
    expect(draft.appointment_id).toBeUndefined();
    const still = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(still.rows[0]?.status).toBe("pending");
  });

  it("falha total da tool usa fala segura, não «encerrando» e não cai no LLM", async () => {
    const spy = vi.spyOn(aiTools, "getNextSlots").mockResolvedValue({ error: "timeout" } as never);
    try {
      const result = await runUser(toolFx, "Pode ser o próximo");
      expect(result.reply).toBe(NEXT_SLOTS_UNAVAILABLE_SAFE);
      expect(result.reply).not.toContain(CLOSING_TODAY_THEN_TOMORROW);
      expect(result.reply).not.toMatch(/Qual hora você prefere/);
      expect(result.turnTrace?.silencedBy).toBeFalsy();
    } finally {
      spy.mockRestore();
    }
  });

  it("«você é um robô?» desvia, segue o atendimento e não se afirma humano nem revela IA", async () => {
    const withService = await runUser(robotFx, "você é um robô?");
    expect(withService.reply.startsWith(ROBOT_QUESTION_DEFLECT)).toBe(true);
    expect(withService.reply).toMatch(/às\s+\d{1,2}h/);
    expect(withService.reply).not.toMatch(/sou (um |uma )?(ia|intelig[eê]ncia|rob[oô]|bot|humano|pessoa)/i);
    expect(withService.reply).not.toMatch(/intelig[eê]ncia artificial|\bIA\b/i);
    expect(withService.turnTrace?.silencedBy).toBeFalsy();

    // Sem serviço no rascunho (a história ainda tem «Só o corte mesmo», então pode oferecer).
    // Apaga o histórico de serviço para forçar só o desvio + continuar.
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [robotBareFx.conversationId]);
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', 'oi'), ($1, 'assistant', 'Oi! Como posso ajudar?')`,
      [robotBareFx.conversationId],
    );
    const bare = await runUser(robotBareFx, "você é um robô?");
    expect(bare.reply).toContain(ROBOT_QUESTION_DEFLECT);
    expect(bare.reply).toContain(ROBOT_QUESTION_CONTINUE);
    expect(bare.reply).not.toMatch(/sou (um |uma )?(ia|intelig[eê]ncia|rob[oô]|bot|humano|pessoa)/i);
  });

  it("não vaza horários entre barbearias (isolamento de tenant)", async () => {
    const clientA = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Outro', $2) RETURNING id`,
      [shopA.barbershopId, "5511988800799"],
    );
    // Ocupa a agenda de A amanhã das 09h às 20h, de 30 em 30.
    let t = 9 * 60;
    while (t + 30 <= 20 * 60) {
      const hh = String(Math.floor(t / 60)).padStart(2, "0");
      const mm = String(t % 60).padStart(2, "0");
      const appt = await pool.query<{ id: string }>(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, $5::date, $6, 30, 40, 10, 'pending')
         RETURNING id`,
        [shopA.barbershopId, clientA.rows[0]!.id, shopA.barberId, shopA.serviceId, shopA.tomorrowIso, `${hh}:${mm}`],
      );
      await pool.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, 40, 30, 'Corte', 0)`,
        [appt.rows[0]!.id, shopA.serviceId],
      );
      t += 30;
    }
    const resultB = await runUser(shopB, "Pode ser o próximo");
    expect(resultB.reply).toMatch(/Consigo te atender/i);
    expect(resultB.reply).toMatch(/às\s+\d{1,2}h/);
    const draftB = await loadDraft(shopB.conversationId);
    expect(draftB.service_ids).toEqual([shopB.serviceId]);
    expect(draftB.barber_id).toBe(shopB.barberId);
    const resultA = await runUser(shopA, "Pode ser o próximo");
    // A está lotada amanhã: ou rola o dia, ou pede outro dia — não deve oferecer um buraco de B.
    expect(resultA.reply.trim().length).toBeGreaterThan(0);
    expect(resultA.reply).not.toMatch(/Qual hora você prefere/);
    const draftA = await loadDraft(shopA.conversationId);
    expect(draftA.service_ids).toEqual([shopA.serviceId]);
    expect(draftA.barber_id).toBe(shopA.barberId);
    if (draftA.date === shopA.tomorrowIso) {
      expect(draftA.offeredTimes ?? []).toHaveLength(0);
    }
  });
});
