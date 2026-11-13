/**
 * AgentContext — all DB-loaded and deterministically-derived data needed by runAgent.
 *
 * buildAgentContext() is the single function that:
 *   - executes every DB query that was previously scattered through the first half of runAgent
 *   - derives computed values (timezone, dates, premium flag, upcomingBooked, etc.)
 *   - returns a typed, self-contained snapshot that runAgent can destructure
 *
 * What is NOT in AgentContext:
 *   - systemPrompt (built in runAgent using this data)
 *   - catalog (listServices/listBarbers) — loaded after `desired` in runAgent
 *   - intent-conditioned loads (planSubscription) — stay in runAgent
 *   - the LLM loop and all of its mutable state
 */

import { pool } from "../../db.js";
import * as aiTools from "../tools.js";
import { addDaysIso } from "../date-calendar.js";
import {
  getClientMemory,
  clientMemoryTableExists,
} from "../memory/client-memory.js";
import type { ClientMemoryRow } from "../memory/client-memory.js";
import {
  loadBookingDraft,
  type BookingDraft,
} from "../booking-draft.js";
import {
  confirmedPersonName,
  isUsableClientName,
  supportsSelectedBarbershopColumn,
  type UpcomingApptRow,
} from "../agent.js";
import { lastUserTurnText } from "../conversation-intents.js";

// ── Types re-used by context-builder (minimal, no circular dep) ─────────────

export type AiBarbershopSettings = {
  enabled: boolean;
  timezone: string | null;
  model: string;
  model_premium: string | null;
  temperature: number;
  system_prompt_override: string | null;
  agent_profile: unknown;
  additional_instructions: string | null;
  max_output_tokens: number | null;
};

export type BranchInfo = { id: string; name: string };

export type MessageRow = {
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_payload: unknown;
};

/** The run-time context snapshot returned by buildAgentContext. */
export type AgentContext = {
  // ── AI settings + plan ──────────────────────────────────────────────────
  settings: AiBarbershopSettings | undefined;
  billingPlan: string;

  // ── Account / multi-branch ──────────────────────────────────────────────
  effectiveBarbershopId: string;
  accountBranches: BranchInfo[];
  numberMode: "account_wide" | "per_branch";

  // ── Message count + premium model ───────────────────────────────────────
  messageCount: number;
  premiumAvailable: boolean;
  usePremiumByMessages: boolean;

  // ── Time / timezone ─────────────────────────────────────────────────────
  timeZone: string;
  /** "YYYY-MM-DD HH:mm" in the barbershop timezone */
  dateTimeStr: string;
  /** "YYYY-MM-DD" in the barbershop timezone */
  dateOnlyStr: string;
  tomorrowOnlyStr: string;
  /** "HH:mm" in the barbershop timezone */
  currentTimeHHmm: string;

  // ── Barbershop metadata ─────────────────────────────────────────────────
  barbershopName: string;
  businessHoursRaw: unknown;
  shopAddress: string;
  hasGeoLocation: boolean;

  // ── Client ──────────────────────────────────────────────────────────────
  clientName: string;
  clientNameConfirmed: boolean;
  whatsappPushName: string | null;

  // ── Memory + appointments ────────────────────────────────────────────────
  clientMemory: ClientMemoryRow | null;
  upcomingAppointments: UpcomingApptRow[];
  upcomingBooked: "pending" | "confirmed" | null;
  clientFavorites: unknown;
  /** Last visit row when there are no upcoming appointments, else null. */
  lastVisit: {
    service_names: string;
    barber_name: string;
    time: string;
    service_ids?: string[];
    barber_id?: string;
  } | null;

  // ── Message history ──────────────────────────────────────────────────────
  history: MessageRow[];
  /** Last N messages (trimmed for memory budget) */
  lastN: MessageRow[];
  lastUserTextRaw: string;

  // ── Booking draft ────────────────────────────────────────────────────────
  bookingDraft: BookingDraft;
};

// ── Constants (mirrors runAgent) ─────────────────────────────────────────────
const MAX_MEMORY_MESSAGES = 40;
const ESCALATION_MESSAGE_THRESHOLD = 15;

// ── Helpers ──────────────────────────────────────────────────────────────────

function filterUpcomingFromNow(
  rows: UpcomingApptRow[],
  dateOnlyStr: string,
  currentTimeHHmm: string
): UpcomingApptRow[] {
  return rows.filter((a) => {
    const d = String(a.date).slice(0, 10);
    if (d > dateOnlyStr) return true;
    if (d < dateOnlyStr) return false;
    const t = String(a.time).slice(0, 5);
    return t >= currentTimeHHmm;
  });
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Load all DB data and compute derived values needed by runAgent.
 *
 * @param barbershopId   The barbershop that owns this conversation.
 * @param conversationId The ai_messages conversation id.
 * @param clientPhone    E.164 phone of the inbound client.
 * @param simulatedNow   Optional ISO string to override the current time (for tests).
 */
export async function buildAgentContext(
  barbershopId: string,
  conversationId: string,
  clientPhone: string,
  simulatedNow?: string
): Promise<AgentContext> {
  // ── AI settings ──────────────────────────────────────────────────────────
  const settingsRow = await pool.query<AiBarbershopSettings>(
    `SELECT s.enabled, s.timezone, s.model, s.model_premium, s.temperature,
            s.system_prompt_override, s.agent_profile, s.additional_instructions,
            s.max_output_tokens
     FROM public.barbershop_ai_settings s WHERE s.barbershop_id = $1`,
    [barbershopId]
  );
  const settings = settingsRow.rows[0];

  // ── Billing plan ─────────────────────────────────────────────────────────
  const planRow = await pool.query<{ billing_plan: string | null }>(
    "SELECT billing_plan FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  const billingPlan = planRow.rows[0]?.billing_plan ?? "pro";

  // ── Account-wide / multi-branch resolution ───────────────────────────────
  let effectiveBarbershopId = barbershopId;
  let accountBranches: BranchInfo[] = [];
  let numberMode: "account_wide" | "per_branch" = "per_branch";
  try {
    let selectedId: string | null = null;
    if (await supportsSelectedBarbershopColumn()) {
      const runtimeRow = await pool.query<{ selected_barbershop_id: string | null }>(
        `SELECT selected_barbershop_id FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
        [conversationId]
      );
      selectedId = runtimeRow.rows[0]?.selected_barbershop_id ?? null;
    }
    const accountRow = await pool.query<{ account_id: string | null }>(
      "SELECT account_id FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const accountId = accountRow.rows[0]?.account_id ?? null;
    if (accountId) {
      const accRow = await pool.query<{ whatsapp_number_mode: string }>(
        "SELECT whatsapp_number_mode FROM public.accounts WHERE id = $1",
        [accountId]
      );
      numberMode =
        accRow.rows[0]?.whatsapp_number_mode === "account_wide"
          ? "account_wide"
          : "per_branch";
      const branchesRow = await pool.query<BranchInfo>(
        "SELECT id, name FROM public.barbershops WHERE account_id = $1 ORDER BY name",
        [accountId]
      );
      accountBranches = branchesRow.rows;
      const allowedIds = new Set(accountBranches.map((b) => b.id));
      if (selectedId && allowedIds.has(selectedId)) {
        effectiveBarbershopId = selectedId;
      }
    }
  } catch {
    // Tables/columns may not exist in all environments
  }

  // ── Message count + premium flags ────────────────────────────────────────
  const msgCountRow = await pool.query<{ cnt: string }>(
    "SELECT count(*)::text AS cnt FROM public.ai_messages WHERE conversation_id = $1",
    [conversationId]
  );
  const messageCount = parseInt(msgCountRow.rows[0]?.cnt ?? "0", 10);
  const premiumAvailable =
    billingPlan === "premium" && (settings?.model_premium ?? "").trim() !== "";
  const usePremiumByMessages =
    premiumAvailable && messageCount >= ESCALATION_MESSAGE_THRESHOLD;

  // ── Timezone + dates ─────────────────────────────────────────────────────
  const timeZone =
    settings?.timezone && settings.timezone.includes("/")
      ? settings.timezone
      : "America/Sao_Paulo";
  const simulatedNowDate = simulatedNow ? new Date(simulatedNow) : null;
  const now =
    simulatedNowDate && !Number.isNaN(simulatedNowDate.getTime())
      ? simulatedNowDate
      : new Date();
  const dateTimeStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const dateOnlyStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const tomorrowOnlyStr = addDaysIso(dateOnlyStr, 1);
  const currentTimeHHmm = (
    dateTimeStr.includes(" ") ? dateTimeStr.split(" ")[1] : "00:00"
  )!.slice(0, 5);

  // ── Barbershop metadata ──────────────────────────────────────────────────
  const shopContextRow = await pool.query<{
    name: string;
    business_hours: unknown;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    "SELECT name, business_hours, address, latitude, longitude FROM public.barbershops WHERE id = $1",
    [effectiveBarbershopId]
  );
  const barbershopName = shopContextRow.rows[0]?.name ?? "Barbearia";
  const businessHoursRaw = shopContextRow.rows[0]?.business_hours ?? null;
  const shopAddress = shopContextRow.rows[0]?.address?.trim() ?? "";
  const hasGeoLocation =
    shopContextRow.rows[0]?.latitude != null &&
    shopContextRow.rows[0]?.longitude != null;

  // ── Client identity ──────────────────────────────────────────────────────
  let clientName = "";
  let clientNameConfirmed = false;
  let whatsappPushName: string | null = null;
  try {
    const c = (await aiTools.upsertClient(effectiveBarbershopId, clientPhone)) as unknown;
    if (c && typeof c === "object") {
      const row = c as Record<string, unknown>;
      clientNameConfirmed = row.name_confirmed === true;
      whatsappPushName =
        typeof row.whatsapp_contact_name === "string"
          ? row.whatsapp_contact_name
          : null;
      const maybeName = row.name;
      if (
        typeof maybeName === "string" &&
        clientNameConfirmed &&
        isUsableClientName(maybeName)
      ) {
        const formatted =
          aiTools.formatStoredClientName(maybeName.trim()) ?? maybeName.trim();
        clientName = confirmedPersonName({
          storedName: formatted,
          nameConfirmed: true,
          pushName: whatsappPushName,
        });
      }
    }
  } catch {
    // Proceed without name; agent will ask during turn
  }

  // ── Memory + appointments ────────────────────────────────────────────────
  const memExists = await clientMemoryTableExists();
  const [clientMemory, rawUp, clientFavorites] = await Promise.all([
    memExists
      ? getClientMemory(effectiveBarbershopId, clientPhone)
      : Promise.resolve(null),
    aiTools
      .listClientUpcomingAppointments(effectiveBarbershopId, clientPhone, dateOnlyStr)
      .catch(() => [] as unknown[]),
    aiTools
      .getClientFavoriteServices(effectiveBarbershopId, clientPhone)
      .catch(() => null),
  ]);

  let upcomingAppointments: UpcomingApptRow[] = [];
  try {
    const arr = Array.isArray(rawUp) ? rawUp : [];
    upcomingAppointments = filterUpcomingFromNow(
      arr as UpcomingApptRow[],
      dateOnlyStr,
      currentTimeHHmm
    );
  } catch {
    upcomingAppointments = [];
  }

  const lastVisit =
    upcomingAppointments.length === 0
      ? await aiTools
          .getClientLastAppointment(effectiveBarbershopId, clientPhone)
          .catch(() => null)
      : null;

  const upcomingBooked = ((): "pending" | "confirmed" | null => {
    const pending = upcomingAppointments.find((a) => a.status === "pending");
    if (pending) return "pending";
    if (upcomingAppointments.some((a) => a.status === "confirmed" || !a.status))
      return "confirmed";
    return null;
  })();

  // ── Message history ──────────────────────────────────────────────────────
  const messagesRow = await pool.query<MessageRow>(
    `SELECT role, content, tool_name, tool_payload FROM public.ai_messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  const history = messagesRow.rows;
  const lastN = history.slice(-MAX_MEMORY_MESSAGES);
  const lastUserTextRaw = lastUserTurnText(lastN);

  // ── Booking draft ────────────────────────────────────────────────────────
  const bookingDraft = await loadBookingDraft(conversationId);

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    settings,
    billingPlan,
    effectiveBarbershopId,
    accountBranches,
    numberMode,
    messageCount,
    premiumAvailable,
    usePremiumByMessages,
    timeZone,
    dateTimeStr,
    dateOnlyStr,
    tomorrowOnlyStr,
    currentTimeHHmm,
    barbershopName,
    businessHoursRaw,
    shopAddress,
    hasGeoLocation,
    clientName,
    clientNameConfirmed,
    whatsappPushName,
    clientMemory,
    upcomingAppointments,
    upcomingBooked,
    clientFavorites,
    lastVisit: lastVisit as {
      service_names: string;
      barber_name: string;
      time: string;
      service_ids?: string[];
      barber_id?: string;
    } | null,
    history,
    lastN,
    lastUserTextRaw,
    bookingDraft,
  };
}
