/**
 * Quando as regras não extraem os slots, o LLM só interpreta a fala em
 * { serviço, barbeiro, data, horário, intent } com schema validado.
 * O código continua decidindo tools e confirmação.
 *
 * Produção: flag AI_AGENT_SLOT_INTERPRET (default desligada) para não
 * aumentar o custo. Testes usam --llm none e um intérprete fake determinístico.
 */
import type OpenAI from "openai";
import { DEFAULT_CHAT_MODEL, createChatCompletion } from "../models.js";
import {
  resolveBarberFromText,
  resolveServiceFromText,
  type BookingDraft,
  type CatalogBarber,
  type CatalogService,
} from "../booking-draft.js";

export const SLOT_INTENTS = ["schedule", "reschedule", "cancel", "presence", "unknown"] as const;
export type SlotIntent = (typeof SLOT_INTENTS)[number];

export type InterpretedSlots = {
  intent: SlotIntent | null;
  service: string | null;
  barber: string | null;
  date: string | null;
  time: string | null;
  after_time: string | null;
};

export type SlotInterpreterInput = {
  text: string;
  todayIso: string;
  services: Array<{ id: string; name: string }>;
  barbers: Array<{ id: string; name: string }>;
};

export type SlotInterpreter = (input: SlotInterpreterInput) => Promise<InterpretedSlots | null>;

const EMPTY: InterpretedSlots = {
  intent: null,
  service: null,
  barber: null,
  date: null,
  time: null,
  after_time: null,
};

function fold(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHHmm(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function toHHmm(value: string): string {
  const m = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  const hour = Number(m?.[1] ?? 0);
  const minute = Number(m?.[2] ?? 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function asSlotIntent(value: unknown): SlotIntent | null {
  if (typeof value !== "string") return null;
  const t = fold(value);
  return (SLOT_INTENTS as readonly string[]).includes(t) ? (t as SlotIntent) : null;
}

export function isSlotInterpretEnabled(override?: boolean): boolean {
  if (override === true) return true;
  if (override === false) return false;
  const raw = String(process.env.AI_AGENT_SLOT_INTERPRET ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function validateInterpretedSlots(raw: unknown): InterpretedSlots | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const service = typeof r.service === "string" && r.service.trim() ? r.service.trim() : null;
  const barberRaw = typeof r.barber === "string" && r.barber.trim() ? r.barber.trim() : null;
  const barber = barberRaw && fold(barberRaw) === "any" ? "any" : barberRaw;
  const date = isIsoDate(r.date) ? r.date : null;
  const time = isHHmm(r.time) ? toHHmm(String(r.time)) : null;
  const afterRaw = r.after_time ?? r.afterTime;
  const after_time = isHHmm(afterRaw) ? toHHmm(String(afterRaw)) : null;
  const intent = asSlotIntent(r.intent);
  const slots: InterpretedSlots = {
    intent,
    service,
    barber,
    date,
    time: time && after_time && time === after_time ? null : time,
    after_time: time ? null : after_time,
  };
  if (!slots.intent && !slots.service && !slots.barber && !slots.date && !slots.time && !slots.after_time) {
    return null;
  }
  return slots;
}

/**
 * Só pede o intérprete quando as regras não trouxeram intent nem slots
 * úteis e a fala não é confirmação, saudação ou outro fluxo já coberto.
 */
export function shouldInterpretSlotsWithModel(input: {
  text: string;
  primaryIntent: string;
  slots: { service?: string | null; barber?: string | null; date?: string | null; time?: string | null; afterTime?: string | null };
  isConfirmation?: boolean;
  isGreeting?: boolean;
  isRobotQuestion?: boolean;
  looksLikeNext?: boolean;
  looksLikeCancel?: boolean;
  looksLikeReschedule?: boolean;
  looksLikeConsult?: boolean;
  looksLikePix?: boolean;
  looksLikeLocation?: boolean;
  looksLikePlan?: boolean;
  looksLikeHandoff?: boolean;
}): boolean {
  if (
    input.isConfirmation ||
    input.isGreeting ||
    input.isRobotQuestion ||
    input.looksLikeNext ||
    input.looksLikeCancel ||
    input.looksLikeReschedule ||
    input.looksLikeConsult ||
    input.looksLikePix ||
    input.looksLikeLocation ||
    input.looksLikePlan ||
    input.looksLikeHandoff
  ) {
    return false;
  }
  if (input.primaryIntent && input.primaryIntent !== "unknown") return false;
  if (
    input.slots.service ||
    input.slots.barber ||
    input.slots.date ||
    input.slots.time ||
    input.slots.afterTime
  ) {
    return false;
  }
  return fold(input.text).length >= 12;
}

export function draftPatchFromInterpretedSlots(
  slots: InterpretedSlots,
  catalog: { services: CatalogService[]; barbers: CatalogBarber[] },
): Partial<BookingDraft> {
  const patch: Partial<BookingDraft> = {};
  if (slots.service) {
    const resolved = resolveServiceFromText(slots.service, catalog.services);
    if (resolved.match) {
      patch.service_ids = [resolved.match.id];
      patch.service_name = resolved.match.name;
      if (typeof resolved.match.price === "number" && Number.isFinite(resolved.match.price)) {
        patch.total_price = resolved.match.price;
      }
    } else {
      const named = catalog.services.find((s) => fold(s.name) === fold(slots.service!));
      if (named) {
        patch.service_ids = [named.id];
        patch.service_name = named.name;
      }
    }
  }
  if (slots.barber && fold(slots.barber) !== "any") {
    const barber = resolveBarberFromText(slots.barber, catalog.barbers);
    if (barber) {
      patch.barber_id = barber.id;
      patch.barber_name = barber.name;
    }
  }
  if (slots.date) patch.date = slots.date;
  if (slots.time) patch.time = slots.time;
  else if (slots.after_time) patch.after_time = slots.after_time;
  return patch;
}

export function createFakeSlotInterpreter(
  replies: Record<string, unknown> | ((text: string) => unknown),
): SlotInterpreter {
  return async (input) => {
    const raw =
      typeof replies === "function" ? replies(input.text) : (replies[input.text] ?? replies[fold(input.text)] ?? null);
    return validateInterpretedSlots(raw);
  };
}

const INTERPRET_SYSTEM =
  "Você só interpreta a fala do cliente de barbearia em slots estruturados. " +
  "Não escolhe tools, não confirma agendamento e não inventa horário, serviço ou barbeiro que o cliente não tenha dito. " +
  "Responda apenas um JSON com as chaves intent, service, barber, date, time, after_time. " +
  "intent é schedule, reschedule, cancel, presence ou unknown. " +
  "date é YYYY-MM-DD. time e after_time são HH:mm. Use null quando não houver o dado.";

export const SLOT_INTERPRET_TIMEOUT_MS = 2500;

export type SlotInterpretUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type InterpretSlotsResult = {
  slots: InterpretedSlots | null;
  usage?: SlotInterpretUsage;
  timedOut?: boolean;
};

function usageFromCompletion(completion: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null }): SlotInterpretUsage | undefined {
  const u = completion.usage;
  if (!u) return undefined;
  return {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
  };
}

export async function interpretSlotsWithOpenAI(
  openai: OpenAI,
  input: SlotInterpreterInput,
  opts?: { timeoutMs?: number },
): Promise<InterpretSlotsResult> {
  const catalog = {
    services: input.services.map((s) => s.name),
    barbers: input.barbers.map((b) => b.name),
    today: input.todayIso,
  };
  const timeoutMs = opts?.timeoutMs ?? SLOT_INTERPRET_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const completion = await createChatCompletion(
      openai,
      {
        model: DEFAULT_CHAT_MODEL,
        temperature: 0,
        max_completion_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INTERPRET_SYSTEM },
          {
            role: "user",
            content: `Catálogo: ${JSON.stringify(catalog)}
Fala: ${input.text}`,
          },
        ],
      },
      { signal: ac.signal },
    );
    const usage = usageFromCompletion(completion);
    const content = completion.choices[0]?.message?.content ?? "";
    try {
      return { slots: validateInterpretedSlots(JSON.parse(content)), usage };
    } catch {
      return { slots: null, usage };
    }
  } catch {
    return { slots: null, timedOut: ac.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

export { EMPTY as EMPTY_INTERPRETED_SLOTS };
