/**
 * Motor novo de um turno: interpreta, decide pela máquina, executa os comandos e redige a resposta.
 */
import type OpenAI from "openai";
import { pool } from "../../../db.js";
import { sendBarbershopLocationToClient } from "../../../lib/send-barbershop-location.js";
import {
  composeLocationSent,
  composeShopPixReply,
  composeUpcomingRecap,
  runAgent,
  sanitizeClientFacingReply,
  snapshotCheckAvailability,
  type AgentResult,
} from "../../agent.js";
import { resolveUsualService, type CatalogService } from "../../booking-draft.js";
import { isClientConfirmation, isClientRefusal } from "../../conversation-intents.js";
import {
  addDaysIso,
  describeShopOpenStatus,
  formatResumoWhen,
  formatWeekCalendarForTools,
  shopOpenStatusNow,
} from "../../date-calendar.js";
import { updateClientMemoryFromAppointmentEvent } from "../../memory/client-memory.js";
import { normalizeProfile, profileToSnippet } from "../../prompt-builder.js";
import { setConversationPaused } from "../../runtime-pause.js";
import * as aiTools from "../../tools.js";
import type { AgentTurnTrace, TurnTraceTool } from "../../turn-trace.js";
import { buildAgentContext, type AgentContext } from "../context-builder.js";
import { understandTurn } from "../understanding.js";
import {
  interpretTurnWithOpenAI,
  type InterpretTurnInput,
  type TurnInterpretation,
  type TurnInterpreter,
} from "../turn-interpreter.js";
import { canPolish, polishReply, templateFor } from "./composer.js";
import {
  persistSnapshot,
  restoreSnapshot,
  stepResult,
  stepTurn,
  type ConversationSnapshot,
  type PersistedAgentState,
  type TurnFacts,
  type UpcomingFact,
  type V2Command,
  type V2Context,
} from "./machine.js";

export type RunAgentV2Options = {
  interpret?: TurnInterpreter;
  polish?: boolean;
  persistAssistantMessages?: boolean;
};

const MAX_COMMANDS_PER_TURN = 4;
const SIDE_INTENTS = ["payment", "location", "hours", "consult"] as const;
const WRITE_COMMANDS = new Set<V2Command["type"]>([
  "write_create",
  "write_reschedule",
  "write_cancel",
  "write_presence",
  "add_waitlist",
]);

function firstName(name: string | null | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

function isOk(value: unknown): boolean {
  return value != null && typeof value === "object" && (value as { ok?: unknown }).ok === true;
}

function toCatalog(value: unknown): CatalogService[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const item = row as { id?: unknown; name?: unknown; price?: unknown };
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    const price = Number(item.price);
    return [{ id: item.id, name: item.name, ...(Number.isFinite(price) ? { price } : {}) }];
  });
}

function toUpcoming(context: AgentContext): UpcomingFact[] {
  return context.upcomingAppointments.map((item) => ({
    id: item.id,
    date: String(item.date).slice(0, 10),
    time: String(item.time).slice(0, 5),
    service_ids: item.service_ids ?? [],
    service_names: item.service_names,
    barber_id: item.barber_id ?? null,
    barber_name: item.barber_name,
    status: item.status ?? "pending",
    price: typeof item.price === "number" ? item.price : null,
  }));
}

async function liveReminderAppointment(barbershopId: string, upcoming: UpcomingFact[]): Promise<string | null> {
  const pending = upcoming.filter((item) => item.status === "pending").map((item) => item.id);
  if (!pending.length) return null;
  const row = await pool.query<{ appointment_id: string }>(
    `SELECT appointment_id FROM public.agenda_activity
     WHERE barbershop_id = $1 AND appointment_id = ANY($2::uuid[]) AND type = 'reminder_sent'
       AND created_at > now() - interval '26 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [barbershopId, pending],
  );
  return row.rows[0]?.appointment_id ?? null;
}

/** Sem resposta do modelo, as regras antigas evitam deixar o cliente sem atendimento. */
function rulesFallback(input: InterpretTurnInput, services: CatalogService[], barbers: Array<{ id: string; name: string }>): TurnInterpretation {
  const rules = understandTurn({
    text: input.text,
    todayIso: input.todayIso,
    services,
    barbers,
    previousState: input.state === "reminder_24h_pending" ? "reminder_24h_pending" : "idle",
  });
  const service = rules.service && rules.service !== "ambiguous" ? rules.service.ids?.[0] ?? null : null;
  return {
    intents: rules.intents,
    primary: rules.primary,
    service_id: service,
    service_ambiguous: rules.service === "ambiguous",
    barber_id: rules.barber?.kind === "named" ? (rules.barber.id ?? null) : null,
    barber_any: rules.barber?.kind === "any",
    unknown_barber_name: rules.barber?.kind === "unknown_named" ? rules.barber.name : null,
    date: rules.dateTime?.date ?? null,
    time: rules.dateTime?.time ?? null,
    after_time: null,
    wants_next_slot: Boolean(rules.wantsNextSlot),
    offer_response: isClientConfirmation(input.text) ? "accept" : isClientRefusal(input.text) ? "reject" : "none",
    person_name: null,
    social: "none",
    confidence: rules.confidence,
  };
}

function openFacts(saved: V2Context, state: string, upcoming: UpcomingFact[], reminderId: string | null): string[] {
  const facts: string[] = [];
  if (reminderId) facts.push("Há um lembrete de presença em aberto.");
  if (state === "slot_offered") facts.push(`Oferta em aberto: ${saved.service_name ?? "serviço"} em ${saved.date} às ${saved.time}.`);
  if (state === "awaiting_name") facts.push("O atendente pediu o nome da pessoa para fechar o horário.");
  if (state === "cancel_offered") facts.push("O atendente perguntou se pode cancelar o horário.");
  if (saved.proposed_usual) facts.push(`O atendente sugeriu o serviço de sempre: ${saved.proposed_usual.service_name}.`);
  if (saved.offered_times.length) facts.push(`Horários oferecidos: ${saved.offered_times.join(", ")}.`);
  for (const item of upcoming) facts.push(`Horário marcado: ${item.service_names} em ${item.date} às ${item.time} com ${item.barber_name}.`);
  return facts;
}

async function execute(
  command: V2Command,
  snapshot: ConversationSnapshot,
  env: { shopId: string; conversationId: string; phone: string; name: string; todayIso: string; nowHHmm: string; nowMs: number; writeKey: string; tools: TurnTraceTool[] },
): Promise<ConversationSnapshot> {
  const context = snapshot.context;
  const track = (name: string, ok: boolean) => env.tools.push({ name, ok });

  if (WRITE_COMMANDS.has(command.type) && context.last_write_key === env.writeKey) {
    return stepResult(snapshot, { type: "WRITE_OK", key: env.writeKey });
  }

  if (command.type === "check_slot") {
    const result = await aiTools.checkAvailability(env.shopId, {
      date: context.date!,
      time: context.time!,
      service_ids: context.service_ids,
      ...(context.barber_id ? { barber_id: context.barber_id } : {}),
      ...(context.moving_id ? { exclude_appointment_id: context.moving_id } : {}),
    });
    const slot = snapshotCheckAvailability(result, context.barber_id ?? undefined);
    track("check_availability", Boolean(slot));
    if (slot?.available && slot.barberId) {
      return stepResult(snapshot, {
        type: "SLOT_FREE",
        nowMs: env.nowMs,
        slot: {
          date: slot.date || context.date!,
          time: (slot.time || context.time!).slice(0, 5),
          barber_id: slot.barberId,
          barber_name: slot.barberName || context.barber_name || "o barbeiro",
          price: Number.isFinite(slot.totalPrice) ? slot.totalPrice : null,
          service_name: slot.serviceName || null,
        },
      });
    }
    const times = [...new Set((slot?.alternatives ?? [])
      .filter((item) => !context.barber_id || !item.barber_id || item.barber_id === context.barber_id)
      .map((item) => item.time))].slice(0, 3);
    return stepResult(snapshot, { type: "SLOT_BUSY", times });
  }

  if (command.type === "list_slots") {
    for (let offset = 0; offset <= 7; offset += 1) {
      const date = addDaysIso(context.date ?? env.todayIso, offset);
      const floor = [date === env.todayIso ? env.nowHHmm : null, offset === 0 ? context.after_time : null].filter(Boolean).sort().at(-1);
      const listed = await aiTools.getNextSlots(env.shopId, {
        date,
        service_ids: context.service_ids,
        limit: 8,
        ...(context.barber_id ? { barber_id: context.barber_id } : {}),
        ...(floor ? { after_time: floor } : {}),
        ...(context.moving_id ? { exclude_appointment_id: context.moving_id } : {}),
      });
      const slots = (listed as { slots?: Array<{ time?: string; barber_id?: string; barber_name?: string }> } | null)?.slots ?? [];
      const times = [...new Set(slots.flatMap((slot) => (typeof slot.time === "string" ? [slot.time.slice(0, 5)] : [])))].slice(0, 3);
      if (times.length) {
        track("get_next_slots", true);
        return stepResult(snapshot, {
          type: "SLOTS_LISTED",
          times,
          date,
          ...(slots[0]?.barber_id ? { barber_id: slots[0].barber_id } : {}),
          ...(slots[0]?.barber_name ? { barber_name: slots[0].barber_name } : {}),
        });
      }
    }
    track("get_next_slots", true);
    return stepResult(snapshot, { type: "NO_SLOTS" });
  }

  if (command.type === "open_handoff") {
    await setConversationPaused(env.conversationId, { pausedBy: "rule", reason: "Cliente pediu atendimento humano" }).catch(() => undefined);
    track("open_handoff", true);
    return snapshot;
  }

  let written = false;
  if (command.type === "write_create") {
    const created = await aiTools.createAppointment(
      env.shopId,
      {
        client_phone: env.phone,
        client_name: env.name,
        barber_id: context.barber_id!,
        service_ids: context.service_ids,
        date: context.date!,
        time: context.time!,
      },
      env.conversationId,
    );
    written = Boolean((created as { id?: unknown } | null)?.id);
    track("create_appointment", written);
  } else if (command.type === "write_reschedule") {
    written = isOk(
      await aiTools.rescheduleAppointmentByAgent(
        env.shopId,
        context.moving_id!,
        env.phone,
        { date: context.date!, time: context.time!, ...(context.barber_id ? { barber_id: context.barber_id } : {}), service_ids: context.service_ids },
        env.conversationId,
      ),
    );
    track("reschedule_appointment", written);
  } else if (command.type === "write_cancel") {
    written = isOk(await aiTools.cancelAppointmentByAgent(env.shopId, command.appointment_id, env.phone, env.conversationId));
    track("cancel_appointment", written);
  } else if (command.type === "write_presence") {
    written = isOk(await aiTools.confirmAppointmentByAgent(env.shopId, command.appointment_id, env.phone, env.conversationId));
    track("confirm_appointment", written);
  } else if (command.type === "add_waitlist") {
    const added = await aiTools.addToWaitlist(env.shopId, {
      client_phone: env.phone,
      client_name: env.name || undefined,
      desired_date: context.date!,
      desired_time: context.time!,
      service_id: context.service_ids[0]!,
      ...(context.barber_id ? { barber_id: context.barber_id } : {}),
    });
    written = !(added && typeof added === "object" && "error" in added);
    track("add_to_waitlist", written);
  }
  return stepResult(snapshot, written ? { type: "WRITE_OK", key: env.writeKey } : { type: "WRITE_FAILED" });
}

async function runSideIntents(
  interpretation: TurnInterpretation,
  params: { ctx: AgentContext; shopId: string; phone: string; upcoming: UpcomingFact[]; first?: string; tools: TurnTraceTool[] },
): Promise<string[]> {
  const bubbles: string[] = [];
  for (const intent of SIDE_INTENTS) {
    if (!interpretation.intents.includes(intent)) continue;
    if (intent === "payment") {
      const pix = (await aiTools.sendShopPix(params.shopId, params.phone)) as {
        ok?: boolean; pix_key?: string; pix_key_type?: string | null; pix_holder_name?: string | null; shop_name?: string | null;
      } | null;
      params.tools.push({ name: "send_shop_pix", ok: Boolean(pix?.ok && pix.pix_key) });
      bubbles.push(pix?.ok && pix.pix_key
        ? composeShopPixReply({ pixKey: pix.pix_key, keyType: pix.pix_key_type, holderName: pix.pix_holder_name, shopName: pix.shop_name })
        : "A chave PIX a equipe te passa por aqui.");
    } else if (intent === "location") {
      const sent = await sendBarbershopLocationToClient(params.shopId, params.phone);
      const ok = "ok" in sent && sent.ok;
      params.tools.push({ name: "send_barbershop_location", ok });
      bubbles.push(ok ? composeLocationSent() : params.ctx.shopAddress ? `Nosso endereço: ${params.ctx.shopAddress}` : "A equipe te passa o endereço por aqui.");
    } else if (intent === "hours") {
      bubbles.push(describeShopOpenStatus(shopOpenStatusNow({
        todayIso: params.ctx.dateOnlyStr,
        nowHHmm: params.ctx.currentTimeHHmm,
        businessHours: (params.ctx.businessHoursRaw ?? null) as Parameters<typeof shopOpenStatusNow>[0]["businessHours"],
      })));
    } else {
      const next = params.upcoming[0];
      bubbles.push(next
        ? composeUpcomingRecap({
            firstName: params.first,
            serviceName: next.service_names,
            when: formatResumoWhen(next.date, next.time, params.ctx.dateOnlyStr),
            barberName: next.barber_name,
            ...(next.price != null ? { price: next.price } : {}),
          })
        : "Você não tem horário marcado agora. Quer agendar um?");
    }
  }
  return bubbles;
}

async function loadRuntime(conversationId: string): Promise<{ saved: PersistedAgentState | null; writeKey: string }> {
  const [runtime, lastUser] = await Promise.all([
    pool.query<{ agent_state: PersistedAgentState | null }>(
      `SELECT agent_state FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
      [conversationId],
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM public.ai_messages WHERE conversation_id = $1 AND role = 'user' ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    ),
  ]);
  return { saved: runtime.rows[0]?.agent_state ?? null, writeKey: lastUser.rows[0]?.id ?? "" };
}

async function saveRuntime(conversationId: string, snapshot: ConversationSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO public.ai_conversation_runtime (conversation_id, agent_state, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (conversation_id) DO UPDATE SET agent_state = $2::jsonb, updated_at = now()`,
    [conversationId, JSON.stringify(persistSnapshot(snapshot))],
  );
}

export async function runAgentV2(
  barbershopId: string,
  conversationId: string,
  clientPhone: string,
  openai: OpenAI,
  options: RunAgentV2Options = {},
): Promise<AgentResult> {
  const ctx = await buildAgentContext(barbershopId, conversationId, clientPhone);
  const shopId = ctx.effectiveBarbershopId;
  const [servicesRaw, barbersRaw, runtime] = await Promise.all([
    aiTools.listServices(shopId),
    aiTools.listBarbers(shopId),
    loadRuntime(conversationId),
  ]);
  const services = toCatalog(servicesRaw);
  const barbers = toCatalog(barbersRaw).map(({ id, name }) => ({ id, name }));
  const upcoming = toUpcoming(ctx);
  const reminderId = await liveReminderAppointment(shopId, upcoming);
  let snapshot = restoreSnapshot(runtime.saved);
  const state = String(snapshot.value);

  const input: InterpretTurnInput = {
    text: ctx.lastUserTextRaw,
    history: ctx.lastN
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content?.trim())
      .slice(0, -1)
      .map((message) => ({ role: message.role as "user" | "assistant", content: String(message.content) })),
    state: reminderId && state === "idle" ? "reminder_24h_pending" : state,
    openFacts: openFacts(snapshot.context, state, upcoming, reminderId),
    todayIso: ctx.dateOnlyStr,
    nowHHmm: ctx.currentTimeHHmm,
    calendar: formatWeekCalendarForTools(ctx.dateOnlyStr),
    services: services.map(({ id, name }) => ({ id, name })),
    barbers,
  };
  const interpret = options.interpret ?? ((value: InterpretTurnInput) => interpretTurnWithOpenAI(openai, value));
  const interpreted = await interpret(input);
  const interpretation = interpreted.interpretation ?? rulesFallback(input, services, barbers);

  const statedName = interpretation.person_name ? (aiTools.formatStoredClientName(interpretation.person_name) ?? interpretation.person_name) : "";
  if (statedName) await aiTools.upsertClient(shopId, clientPhone, statedName).catch(() => undefined);
  const personName = statedName || ctx.clientName || null;

  const facts: TurnFacts = {
    interpretation,
    upcoming,
    reminderAppointmentId: reminderId,
    personName,
    services: services.map((item) => ({ id: item.id, name: item.name, price: item.price ?? null })),
    barbers,
    usualService: resolveUsualService({
      favorites: ctx.clientFavorites as Parameters<typeof resolveUsualService>[0]["favorites"],
      memory: ctx.clientMemory,
      catalog: services,
    }),
    todayIso: ctx.dateOnlyStr,
    nowHHmm: ctx.currentTimeHHmm,
    nowMs: Date.now(),
  };

  snapshot = stepTurn(snapshot, facts);
  if (snapshot.context.say?.kind === "delegate_legacy") {
    return runAgent(barbershopId, conversationId, clientPhone, openai, {
      persistAssistantMessages: options.persistAssistantMessages,
    });
  }

  const tools: TurnTraceTool[] = [];
  const env = {
    shopId,
    conversationId,
    phone: clientPhone,
    name: personName ?? "",
    todayIso: ctx.dateOnlyStr,
    nowHHmm: ctx.currentTimeHHmm,
    nowMs: facts.nowMs,
    writeKey: runtime.writeKey,
    tools,
  };
  for (let index = 0; index < MAX_COMMANDS_PER_TURN && snapshot.context.command; index += 1) {
    const command: V2Command = snapshot.context.command;
    const next = await execute(command, snapshot, env);
    if (WRITE_COMMANDS.has(command.type) && next.context.last_write_key === env.writeKey) await saveRuntime(conversationId, next);
    if (next === snapshot) break;
    snapshot = next;
  }

  const say = snapshot.context.say ?? { kind: "clarify" as const };
  const first = firstName(personName);
  const data = {
    say,
    context: snapshot.context,
    upcoming,
    ...(first ? { firstName: first } : {}),
    todayIso: ctx.dateOnlyStr,
    nowHHmm: ctx.currentTimeHHmm,
    social: interpretation.social,
    services: services.map((item) => item.name),
    barbersByName: barbers.map((item) => item.name),
  };
  let reply = templateFor(data);
  const shouldPolish = options.polish ?? process.env.AI_AGENT_V2_COMPOSER !== "false";
  if (reply && shouldPolish && canPolish(say.kind)) {
    const profile = normalizeProfile(ctx.settings?.agent_profile);
    reply = await polishReply(openai, reply, {
      tone: profileToSnippet(profile),
      recentReplies: input.history.filter((message) => message.role === "assistant").map((message) => message.content),
      services: data.services,
      barbers: data.barbersByName,
    });
  }
  const sideBubbles = await runSideIntents(interpretation, { ctx, shopId, phone: clientPhone, upcoming, ...(first ? { first } : {}), tools });
  reply = sanitizeClientFacingReply([reply, ...sideBubbles].filter(Boolean).join("[[MSG]]"));

  const done = { booked: "appointment_created", moved: "appointment_rescheduled", cancelled: "appointment_cancelled", presence_confirmed: "appointment_confirmed", handoff: "handoff_requested" } as const;
  const resultState = say.kind in done ? done[say.kind as keyof typeof done] : undefined;
  if (say.kind === "booked" || say.kind === "moved" || say.kind === "cancelled") {
    const eventType = say.kind === "booked" ? "appointment_created" : say.kind === "moved" ? "appointment_rescheduled" : "appointment_cancelled";
    await updateClientMemoryFromAppointmentEvent({
      eventType,
      barbershopId: shopId,
      clientPhone,
      ...(snapshot.context.barber_id ? { barberId: snapshot.context.barber_id } : {}),
      ...(snapshot.context.service_name ? { serviceNames: [snapshot.context.service_name] } : {}),
      ...(snapshot.context.time ? { time: snapshot.context.time } : {}),
    }).catch(() => undefined);
    snapshot = restoreSnapshot({ version: 1, value: "idle", context: { ...persistSnapshot(snapshot).context, service_ids: [], service_name: null, price: null, barber_id: null, barber_name: null, date: null, time: null, after_time: null, moving_id: null, offer_issued_ms: null } });
  }
  await saveRuntime(conversationId, snapshot);
  if (options.persistAssistantMessages !== false && reply) {
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [conversationId, reply]);
  }

  const turnTrace: AgentTurnTrace = {
    decisionOwner: "orchestrator",
    conversationState: state,
    canonicalState: String(snapshot.value),
    intent: {
      primary: interpretation.primary,
      intents: interpretation.intents,
      confidence: interpretation.confidence,
      service: facts.services.find((item) => item.id === interpretation.service_id)?.name ?? null,
      barber: barbers.find((item) => item.id === interpretation.barber_id)?.name ?? null,
      date: interpretation.date,
      time: interpretation.time,
    },
    routing: {
      primaryIntent: interpretation.primary,
      triggerHandoff: say.kind === "handoff",
      handoffReason: say.kind === "handoff" ? "explicit_request" : null,
      clearPlanOffered: false,
      requiresBarberDisclosure: Boolean(interpretation.unknown_barber_name),
      unknownBarberName: interpretation.unknown_barber_name,
      handleNow: interpretation.intents,
      deferred: [],
      applied: [`v2:${say.kind}`],
    },
    nameKnown: Boolean(personName),
    nameSource: statedName ? "explicit" : null,
    openai: [],
    toolsExecuted: tools,
    catalogRejections: [],
  };
  return {
    reply,
    ...(interpreted.usage ? { usage: interpreted.usage } : {}),
    ...(resultState ? { state: resultState } : {}),
    turnTrace,
  };
}
