/**
 * Regression: "Pode ser o próximo" after "Qual horário você prefere?" must offer
 * 2–3 concrete slots (or the agreed closing-today copy) — never stay silent and
 * never only re-ask "Qual hora você prefere?".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { runAgent } from "../ai/agent.js";
import { CLOSING_TODAY_THEN_TOMORROW } from "../ai/booking-draft.js";
import type OpenAI from "openai";

const SLUG_PREFIX = "test-next-slot-";
const OPEN_WEEK = {
  monday: { start: "09:00", end: "20:00" },
  tuesday: { start: "09:00", end: "20:00" },
  wednesday: { start: "09:00", end: "20:00" },
  thursday: { start: "09:00", end: "20:00" },
  friday: { start: "09:00", end: "20:00" },
  saturday: { start: "09:00", end: "20:00" },
  sunday: { start: "09:00", end: "20:00" },
};
const TODAY_ALREADY_CLOSED = {
  ...OPEN_WEEK,
  monday: { start: "09:00", end: "09:30" },
  tuesday: { start: "09:00", end: "09:30" },
  wednesday: { start: "09:00", end: "09:30" },
  thursday: { start: "09:00", end: "09:30" },
  friday: { start: "09:00", end: "09:30" },
  saturday: { start: "09:00", end: "09:30" },
  sunday: { start: "09:00", end: "09:30" },
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
}): Promise<ShopFx> {
  const slug = `${SLUG_PREFIX}${params.suffix}-${Date.now()}`;
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
     VALUES ($1, 'Corte', 40, 30, true) RETURNING id`,
    [barbershopId],
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

async function wipe(fx: ShopFx | null) {
  if (!fx?.barbershopId) return;
  await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.ai_conversations WHERE id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [fx.barbershopId]);
}

describe("agente — 'Pode ser o próximo' oferece horários concretos", () => {
  let ok = false;
  let openFx: ShopFx | null = null;
  let closedFx: ShopFx | null = null;
  let thinFx: ShopFx | null = null;

  beforeAll(async () => {
    ok = await dbAvailable();
    if (!ok) return;
    openFx = await seedShop({
      suffix: "open",
      phone: "5511988800701",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
    });
    thinFx = await seedShop({
      suffix: "thin",
      phone: "5511988800703",
      hours: OPEN_WEEK,
      draftDate: "tomorrow",
      draftServices: false,
    });
    closedFx = await seedShop({
      suffix: "closed",
      phone: "5511988800702",
      hours: {
        ...TODAY_ALREADY_CLOSED,
        monday: OPEN_WEEK.monday,
        tuesday: OPEN_WEEK.tuesday,
        wednesday: OPEN_WEEK.wednesday,
        thursday: OPEN_WEEK.thursday,
        friday: OPEN_WEEK.friday,
        saturday: OPEN_WEEK.saturday,
        sunday: OPEN_WEEK.sunday,
      },
      draftDate: "today",
    });
    // Force *today* closed in closedFx while leaving tomorrow open: overwrite today's weekday only.
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
    // to_char 'day' is English padded; already trimmed. If locale is pt, map below.
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
      closedFx.barbershopId,
      JSON.stringify(hours),
    ]);
  });

  afterAll(async () => {
    await wipe(openFx);
    await wipe(closedFx);
    await wipe(thinFx);
  });

  it("com vaga no dia do rascunho, oferece 2–3 horários e não fica em silêncio", async () => {
    if (!ok || !openFx) return;
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
      openFx.conversationId,
      "Pode ser o próximo",
    ]);
    const result = await runAgent(
      openFx.barbershopId,
      openFx.conversationId,
      openFx.clientPhone,
      stubOpenAIMustNotBeCalled(),
      { persistAssistantMessages: false },
    );
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(result.reply).toMatch(/Consigo te atender/i);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    expect(result.turnTrace?.silencedBy).toBeFalsy();
    const usedTool = result.turnTrace?.toolsExecuted?.some((t) => t.name === "get_next_slots" && t.ok);
    expect(usedTool).toBe(true);
  });

  it("perto do fechamento, avisa que estamos encerrando e oferece horários de amanhã", async () => {
    if (!ok || !closedFx) return;
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
      closedFx.conversationId,
      "Pode ser o próximo",
    ]);
    const result = await runAgent(
      closedFx.barbershopId,
      closedFx.conversationId,
      closedFx.clientPhone,
      stubOpenAIMustNotBeCalled(),
      { persistAssistantMessages: false },
    );
    expect(result.reply).toContain(CLOSING_TODAY_THEN_TOMORROW);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    expect(result.reply.trim().length).toBeGreaterThan(0);
  });

  it("mesmo com o rascunho só com a data, recupera 'Só o corte mesmo' e oferece horários", async () => {
    if (!ok || !thinFx) return;
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
      thinFx.conversationId,
      "Pode ser o próximo",
    ]);
    const result = await runAgent(
      thinFx.barbershopId,
      thinFx.conversationId,
      thinFx.clientPhone,
      stubOpenAIMustNotBeCalled(),
      { persistAssistantMessages: false },
    );
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(result.reply).toMatch(/Consigo te atender/i);
    expect(result.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.reply).not.toMatch(/Qual hora você prefere/);
    expect(result.reply).not.toMatch(/simples ou o combo/);
    expect(result.turnTrace?.silencedBy).toBeFalsy();
  });
});
