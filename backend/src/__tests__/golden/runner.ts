/**
 * Layer-2 golden runner: a Scenario is a sequence of Turns run against a real
 * Postgres fixture and runAgent() end-to-end, with OpenAI replaced by a scripted
 * stand-in. Contracts read the structured trace (turnTrace, result.state, draft,
 * pending intents, DB rows) — never the reply text.
 */
import type OpenAI from "openai";
import { pool } from "../../db.js";
import { ensureCriticalSchema } from "../../db/ensure-schema.js";
import { runAgent, type AgentResult } from "../../ai/agent.js";
import { loadBookingDraft, type BookingDraft } from "../../ai/booking-draft.js";
import { loadPendingIntents, type PendingIntents } from "../../ai/agent/pending-intents.js";
import type { TurnTraceTool, TurnTraceCatalogRejection } from "../../ai/turn-trace.js";

const SLUG_PREFIX = "test-golden-";
const TIMEZONE = "America/Sao_Paulo";
const OPEN_ALL_WEEK = {
  monday: { start: "09:00", end: "20:00" },
  tuesday: { start: "09:00", end: "20:00" },
  wednesday: { start: "09:00", end: "20:00" },
  thursday: { start: "09:00", end: "20:00" },
  friday: { start: "09:00", end: "20:00" },
  saturday: { start: "09:00", end: "20:00" },
  sunday: { start: "09:00", end: "20:00" },
};

export type GoldenFixture = {
  barbershopId: string;
  conversationId: string;
  clientPhone: string;
  clientId: string | null;
  barbers: { lucas: string; eduardo: string };
  services: { corte: string; barba: string; corteBarba: string };
  upcomingAppointmentId: string | null;
  tomorrowIso: string;
};

export type GoldenClient = {
  /** Stored, confirmed name. Omit for a first-contact client. */
  name?: string;
  /** A completed "Corte masculino" visit with Eduardo ten days ago. */
  pastVisit?: boolean;
  /** A pending "Corte masculino" appointment with Eduardo in two days at 18:00. */
  upcoming?: boolean;
};

export type ScriptedRound =
  | { tool: string; args: Record<string, unknown> }
  | { content: string };

export type Contract =
  | { kind: "intent_primary"; equals: string }
  | { kind: "intents_include"; value: string }
  | { kind: "intents_exclude"; value: string }
  | { kind: "intent_field"; field: "service" | "barber" | "date" | "time"; equals: string | null }
  | { kind: "routing_primary"; equals: string }
  | { kind: "routing_handle_now"; equals: string[] }
  | { kind: "routing_deferred"; equals: string[] }
  | { kind: "routing_applied_includes"; value: string }
  | { kind: "routing_applied_excludes"; value: string }
  | { kind: "barber_disclosure"; name: string }
  | { kind: "name_known"; equals: boolean }
  | { kind: "name_source"; equals: "explicit" | "leading_address" | null }
  | { kind: "tools_executed"; equals: TurnTraceTool[] }
  | { kind: "tools_executed_includes"; value: TurnTraceTool }
  | { kind: "tools_executed_excludes"; value: string }
  | { kind: "catalog_rejections"; equals: TurnTraceCatalogRejection[] }
  | { kind: "state"; equals: AgentResult["state"] | null }
  | { kind: "not_silenced" }
  | { kind: "draft_status"; equals: BookingDraft["status"] }
  | { kind: "draft_service_ids"; equals: string[] }
  | { kind: "draft_barber_id"; equals: string | null }
  | { kind: "draft_last_question"; equals: NonNullable<BookingDraft["lastAgentQuestion"]> | null }
  | { kind: "draft_proposal_service_ids"; equals: string[] }
  | { kind: "draft_usual_suggested"; equals: boolean }
  | { kind: "reply_includes"; value: string }
  | { kind: "reply_excludes"; value: string }
  | { kind: "draft_time_not"; value: string }
  | { kind: "pending_intents"; equals: PendingIntents }
  | { kind: "openai_rounds"; equals: number }
  | { kind: "activity_includes"; value: string }
  | { kind: "client_name"; equals: string | null }
  | { kind: "appointment_status"; appointmentId: string; equals: string };

export type GoldenTurn = {
  user: string;
  llm: (fx: GoldenFixture) => ScriptedRound[];
  contracts: (fx: GoldenFixture) => Contract[];
};

export type GoldenScenario = {
  id: string;
  client: GoldenClient;
  /** Runs after the shop exists and before the first turn. */
  prepare?: (fx: GoldenFixture) => Promise<void>;
  turns: GoldenTurn[];
};

export type TurnOutcome = {
  result: AgentResult;
  draft: BookingDraft;
  pending: PendingIntents;
  clientName: string | null;
  appointmentStatuses: Map<string, string>;
  activityTypes: string[];
};

function isoDateInTimezone(offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True when Postgres is reachable; also applies the idempotent runtime schema the agent relies on. */
export async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    await ensureCriticalSchema();
    return true;
  } catch {
    return false;
  }
}

/** Scripted OpenAI stand-in. Rounds past the script get a neutral closing reply. */
export function scriptedOpenAI(rounds: ScriptedRound[]): OpenAI {
  let index = 0;
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return {
    chat: {
      completions: {
        create: async () => {
          const round = rounds[index] ?? { content: "Certo." };
          index += 1;
          if ("tool" in round) {
            return {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: `call_golden_${index}`,
                        type: "function",
                        function: { name: round.tool, arguments: JSON.stringify(round.args) },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage,
            };
          }
          return {
            choices: [{ message: { content: round.content, tool_calls: undefined }, finish_reason: "stop" }],
            usage,
          };
        },
      },
    },
  } as unknown as OpenAI;
}

export async function createGoldenFixture(scenarioId: string, client: GoldenClient): Promise<GoldenFixture> {
  const slug = `${SLUG_PREFIX}${scenarioId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const clientPhone = `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, '5511999990090', 'pro', $2, $3::jsonb) RETURNING id`,
    [`Golden ${slug}`, slug, JSON.stringify(OPEN_ALL_WEEK)],
  );
  const barbershopId = shop.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
     VALUES ($1, true, $2, 'gpt-4o-mini')
     ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true, timezone = $2`,
    [barbershopId, TIMEZONE],
  );

  const insertBarber = async (name: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [barbershopId, name],
      )
    ).rows[0]!.id;
  const insertService = async (name: string, price: number, minutes: number) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [barbershopId, name, price, minutes],
      )
    ).rows[0]!.id;

  const barbers = { lucas: await insertBarber("Lucas Lima"), eduardo: await insertBarber("Eduardo Gustavo") };
  const services = {
    corte: await insertService("Corte masculino", 35, 30),
    barba: await insertService("Barba", 25, 30),
    corteBarba: await insertService("Corte e Barba", 55, 60),
  };

  let clientId: string | null = null;
  if (client.name) {
    clientId = (
      await pool.query<{ id: string }>(
        `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, $2, $3, true) RETURNING id`,
        [barbershopId, client.name, clientPhone],
      )
    ).rows[0]!.id;
  }

  const insertAppointment = async (offsetDays: number, time: string, status: string) => {
    const appointmentId = (
      await pool.query<{ id: string }>(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 35, 14, $7) RETURNING id`,
        [barbershopId, clientId, barbers.eduardo, services.corte, isoDateInTimezone(offsetDays), time, status],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
       VALUES ($1, $2, 35, 30, 'Corte masculino', 0)`,
      [appointmentId, services.corte],
    );
    return appointmentId;
  };

  if (clientId && client.pastVisit) await insertAppointment(-10, "10:00", "completed");
  const upcomingAppointmentId = clientId && client.upcoming ? await insertAppointment(2, "18:00", "pending") : null;

  const conversationId = (
    await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
       VALUES ($1, 'whatsapp', $2) RETURNING id`,
      [barbershopId, clientPhone],
    )
  ).rows[0]!.id;

  return {
    barbershopId,
    conversationId,
    clientPhone,
    clientId,
    barbers,
    services,
    upcomingAppointmentId,
    tomorrowIso: isoDateInTimezone(1),
  };
}

export async function deleteGoldenFixture(fx: GoldenFixture): Promise<void> {
  const shop = [fx.barbershopId];
  await pool.query(
    `DELETE FROM public.ai_messages WHERE conversation_id IN (SELECT id FROM public.ai_conversations WHERE barbershop_id = ANY($1::uuid[]))`,
    [shop],
  );
  await pool.query(
    `DELETE FROM public.ai_conversation_runtime WHERE conversation_id IN (SELECT id FROM public.ai_conversations WHERE barbershop_id = ANY($1::uuid[]))`,
    [shop],
  );
  await pool.query(`DELETE FROM public.ai_conversations WHERE barbershop_id = ANY($1::uuid[])`, [shop]);
  await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = ANY($1::uuid[])`, [shop]).catch(() => undefined);
  await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = ANY($1::uuid[])`, [shop]).catch(() => undefined);
  await pool.query(
    `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = ANY($1::uuid[]))`,
    [shop],
  );
  await pool.query(`DELETE FROM public.appointments WHERE barbershop_id = ANY($1::uuid[])`, [shop]);
  await pool.query(`DELETE FROM public.client_memory WHERE barbershop_id = ANY($1::uuid[])`, [shop]).catch(() => undefined);
  await pool.query(`DELETE FROM public.clients WHERE barbershop_id = ANY($1::uuid[])`, [shop]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = ANY($1::uuid[])`, [shop]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = ANY($1::uuid[])`, [shop]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = ANY($1::uuid[]) AND slug LIKE $2`, [shop, `${SLUG_PREFIX}%`]);
}

export async function runGoldenTurn(fx: GoldenFixture, turn: GoldenTurn): Promise<TurnOutcome> {
  await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
    fx.conversationId,
    turn.user,
  ]);
  const result = await runAgent(fx.barbershopId, fx.conversationId, fx.clientPhone, scriptedOpenAI(turn.llm(fx)), {
    persistAssistantMessages: true,
  });
  const draft = await loadBookingDraft(fx.conversationId);
  const pending = await loadPendingIntents(fx.conversationId);
  const client = await pool.query<{ name: string | null; name_confirmed: boolean | null }>(
    `SELECT name, name_confirmed FROM public.clients WHERE barbershop_id = $1 AND phone = $2 LIMIT 1`,
    [fx.barbershopId, fx.clientPhone],
  );
  const row = client.rows[0];
  const appointments = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM public.appointments WHERE barbershop_id = $1`,
    [fx.barbershopId],
  );
  const activity = await pool.query<{ type: string }>(
    `SELECT type FROM public.agenda_activity WHERE conversation_id = $1`,
    [fx.conversationId],
  );
  return {
    result,
    draft,
    pending,
    clientName: row && row.name_confirmed ? row.name : null,
    appointmentStatuses: new Map(appointments.rows.map((a) => [a.id, a.status])),
    activityTypes: activity.rows.map((a) => a.type),
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Returns one message per broken contract; an empty list means the turn honored all of them. */
export function checkContracts(outcome: TurnOutcome, contracts: Contract[]): string[] {
  const trace = outcome.result.turnTrace;
  const intent = trace?.intent ?? null;
  const routing = trace?.routing ?? null;
  const failures: string[] = [];
  const fail = (c: Contract, actual: unknown) =>
    failures.push(`${c.kind}: expected ${JSON.stringify(c)} got ${JSON.stringify(actual)}`);

  for (const c of contracts) {
    switch (c.kind) {
      case "intent_primary":
        if (intent?.primary !== c.equals) fail(c, intent?.primary);
        break;
      case "intents_include":
        if (!intent?.intents.includes(c.value)) fail(c, intent?.intents);
        break;
      case "intents_exclude":
        if (intent?.intents.includes(c.value)) fail(c, intent?.intents);
        break;
      case "intent_field":
        if ((intent?.[c.field] ?? null) !== c.equals) fail(c, intent?.[c.field]);
        break;
      case "routing_primary":
        if (routing?.primaryIntent !== c.equals) fail(c, routing?.primaryIntent);
        break;
      case "routing_handle_now":
        if (!same(routing?.handleNow, c.equals)) fail(c, routing?.handleNow);
        break;
      case "routing_deferred":
        if (!same(routing?.deferred, c.equals)) fail(c, routing?.deferred);
        break;
      case "routing_applied_includes":
        if (!routing?.applied.includes(c.value)) fail(c, routing?.applied);
        break;
      case "routing_applied_excludes":
        if (routing?.applied.includes(c.value)) fail(c, routing?.applied);
        break;
      case "barber_disclosure":
        if (!routing?.requiresBarberDisclosure || routing.unknownBarberName !== c.name) {
          fail(c, { requires: routing?.requiresBarberDisclosure, name: routing?.unknownBarberName });
        }
        break;
      case "name_known":
        if (trace?.nameKnown !== c.equals) fail(c, trace?.nameKnown);
        break;
      case "name_source":
        if ((trace?.nameSource ?? null) !== c.equals) fail(c, trace?.nameSource);
        break;
      case "tools_executed":
        if (!same(trace?.toolsExecuted, c.equals)) fail(c, trace?.toolsExecuted);
        break;
      case "tools_executed_includes":
        if (!(trace?.toolsExecuted ?? []).some((t) => t.name === c.value.name && t.ok === c.value.ok)) {
          fail(c, trace?.toolsExecuted);
        }
        break;
      case "tools_executed_excludes":
        if ((trace?.toolsExecuted ?? []).some((t) => t.name === c.value)) fail(c, trace?.toolsExecuted);
        break;
      case "catalog_rejections":
        if (!same(trace?.catalogRejections, c.equals)) fail(c, trace?.catalogRejections);
        break;
      case "state":
        if ((outcome.result.state ?? null) !== c.equals) fail(c, outcome.result.state);
        break;
      case "not_silenced":
        if (trace?.silencedBy) fail(c, trace.silencedBy);
        break;
      case "draft_status":
        if (outcome.draft.status !== c.equals) fail(c, outcome.draft.status);
        break;
      case "draft_service_ids":
        if (!same(outcome.draft.service_ids ?? [], c.equals)) fail(c, outcome.draft.service_ids);
        break;
      case "draft_barber_id":
        if ((outcome.draft.barber_id ?? null) !== c.equals) fail(c, outcome.draft.barber_id);
        break;
      case "draft_last_question":
        if ((outcome.draft.lastAgentQuestion ?? null) !== c.equals) fail(c, outcome.draft.lastAgentQuestion);
        break;
      case "draft_proposal_service_ids":
        if (!same(outcome.draft.pendingProposal?.service_ids ?? [], c.equals)) fail(c, outcome.draft.pendingProposal);
        break;
      case "draft_usual_suggested":
        if (Boolean(outcome.draft.usualSuggested) !== c.equals) fail(c, outcome.draft.usualSuggested);
        break;
      case "reply_includes":
        if (!outcome.result.reply.includes(c.value)) fail(c, outcome.result.reply);
        break;
      case "reply_excludes":
        if (outcome.result.reply.includes(c.value)) fail(c, outcome.result.reply);
        break;
      case "draft_time_not":
        if ((outcome.draft.time ?? "").slice(0, 5) === c.value) fail(c, outcome.draft.time);
        break;
      case "pending_intents":
        if (!same(outcome.pending, c.equals)) fail(c, outcome.pending);
        break;
      case "openai_rounds":
        if ((outcome.result.turnTrace?.openai.length ?? 0) !== c.equals) {
          fail(c, outcome.result.turnTrace?.openai.length);
        }
        break;
      case "activity_includes":
        if (!outcome.activityTypes.includes(c.value)) fail(c, outcome.activityTypes);
        break;
      case "client_name":
        if (outcome.clientName !== c.equals) fail(c, outcome.clientName);
        break;
      case "appointment_status":
        if (outcome.appointmentStatuses.get(c.appointmentId) !== c.equals) {
          fail(c, outcome.appointmentStatuses.get(c.appointmentId));
        }
        break;
    }
  }
  return failures;
}
