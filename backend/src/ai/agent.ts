import OpenAI from "openai";
import { pool } from "../db.js";
import * as aiTools from "./tools.js";
import { buildSystemPrompt, normalizeProfile } from "./prompt-builder.js";

const OPENING_MESSAGE = "Salve! 😄 Bora deixar na régua? Quer ver os serviços ou já quer agendar? ✂️";

function stripIdsAndUuids(text: string): string {
  const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  return (text ?? "")
    .replace(/\s*\(ID:\s*[0-9a-f-]{36}\s*\)/gi, "")
    .replace(/\bID:\s*[0-9a-f-]{36}\b/gi, "")
    .replace(uuidRegex, "")
    .trim();
}

function normalizeLoose(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePhoneRequest(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return /(me passa|pode me passar|manda|informa).{0,30}(telefone|celular|whats)/i.test(t) || /\bseu telefone\b/i.test(t);
}

const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const MAX_EMOJIS_FOR_VIOLATION = 4;

/** Returns list of violation codes for simulation/quality checks. */
export function detectViolations(reply: string): string[] {
  const out: string[] = [];
  const t = (reply ?? "").trim();
  if (looksLikePhoneRequest(t)) out.push("phone_ask");
  if (UUID_REGEX.test(t)) out.push("uuid_leak");
  const emojis = t.match(EMOJI_REGEX);
  if (emojis != null && emojis.length > MAX_EMOJIS_FOR_VIOLATION) out.push("excessive_emojis");
  return out;
}

function isOutOfScopeFood(text: string): boolean {
  const t = normalizeLoose(text);
  return /\bpizza|pizzaria|hamburguer|lanche|acai\b/.test(t);
}

function extractAskedService(text: string): string | null {
  const t = normalizeLoose(text);
  const m =
    t.match(/\b(voce|voces)\s+tem\s+(.+?)\??$/) ||
    t.match(/\btem\s+(.+?)\??$/) ||
    t.match(/\bfaz(em)?\s+(.+?)\??$/);
  const raw = (m?.[2] ?? m?.[1] ?? "").trim();
  if (!raw) return null;
  return raw.length > 80 ? raw.slice(0, 80) : raw;
}

function inferServiceKeyword(text: string): "corte" | "barba" | "sobrancelha" | "combo" | null {
  const t = normalizeLoose(text);
  if (/\bcorte\s*\+\s*barba|combo\b/.test(t)) return "combo";
  if (/\bbarba\b/.test(t)) return "barba";
  if (/\bsobrancelha\b/.test(t)) return "sobrancelha";
  if (/\bcabelo|cortar|corte\b/.test(t)) return "corte";
  return null;
}

function formatTopServicesForWhatsapp(
  services: Array<{ name: string; price: number; duration_minutes: number }>,
  max = 4
): string {
  return services
    .slice(0, max)
    .map((s, i) => `${i + 1}. *${s.name}* - R$ ${Number(s.price).toFixed(2).replace(".", ",")} (${s.duration_minutes} min)`)
    .join("\n");
}

const DEFAULT_SYSTEM_PROMPT = `Timezone: {{TIMEZONE}} (America/Sao_Paulo, UTC-03:00)
Agora (local): {{DATE_NOW}}
Hoje: {{TODAY_DATE}}
Amanhã: {{TOMORROW_DATE}}
Telefone do cliente: {{CLIENT_PHONE}}
Nome do cliente (se existir): {{CLIENT_NAME}}

Você é o BarbeiroBot da barbearia "{{BARBERSHOP_NAME}}".
Fale estilo WhatsApp: curto, simpático, descolado. Use gírias leves. Emojis só quando fizer sentido (não em toda mensagem).

🎯 Regra #1 (sempre)
Direcione qualquer contato para AGENDAMENTO (ou mostrar serviços e puxar para marcar).

✅ Abertura obrigatória (nunca seja genérico)
Se o cliente mandar “oi/salve/bom dia/opa/e aí” ou estiver vago, responda:
“${OPENING_MESSAGE}”
Proibido: “Como posso ajudar?” / “Estou aqui para ajudar”.

🧰 Ferramentas (não invente)
- list_services (nome, valor, descrição) — nunca falar comissão
- list_barbers — nunca falar “inativo”
- list_appointments — nunca expor dados de outros clientes
- get_next_slots — USE para “primeiro horário”, “hoje” ou “amanhã” sem hora específica. Para HOJE passe after_time com o horário atual ({{DATE_NOW}}).
- check_availability — para um horário específico; para HOJE passe after_time com o horário atual. Nunca sugira horários no passado.
- upsert_client — não peça telefone; peça no máximo o nome 1 vez se precisar
- create_appointment — só após confirmação final única (use client_phone={{CLIENT_PHONE}})
- list_client_upcoming_appointments — quando o cliente quiser cancelar ou reagendar; use o telefone do contexto
- cancel_appointment — cancela pelo appointment_id (retornado por list_client_upcoming_appointments)
- reschedule_appointment — reagenda (appointment_id + nova data/hora); use check_availability antes se precisar

🚫 Regras duras
- Nunca mostrar IDs/UUIDs/códigos.
- Nunca pedir o telefone.
- Nada de confirmar duas vezes. Uma confirmação final curta.
- Fora do escopo: não invente; responda curto e puxe de volta pro agendamento.
- Se o cliente disser “qualquer um / tanto faz”, não pergunte preferência: escolha você um barbeiro disponível.
- Não diga que “tá agendado” antes de realmente criar (create_appointment).
- Formatação WhatsApp: para *negrito* use apenas 1 asterisco: *assim*. Não use **assim**.
- Serviço inexistente: diga que não faz e chame list_services; responda com os principais serviços (ex.: 4) e CTA: “Gostaria de agendar um horário ou ver outras opções?”
- Horários: nunca sugerir horário no passado. Para “hoje” sem hora ou “primeiro horário” use get_next_slots (com after_time quando for hoje). Para horário específico use check_availability (com after_time quando for hoje).
- Quando o horário pedido não encaixar, explique curto e ofereça 2–3 alternativas vindas das ferramentas (get_next_slots ou check_availability).

✅ Fechamento (sem confirmação duplicada)
- Se ainda não souber o nome (CLIENT_NAME vazio), faça o fechamento em 2 mensagens diferentes usando o delimitador [[MSG]]:
  1) resumo + *valor total* + barbeiro + data/hora
  2) pedir o nome para salvar: “Pra salvar aqui, qual seu nome? 🙂”
- Ao receber o nome, considere isso como a confirmação final e chame create_appointment (sem pedir “confirma?” de novo).

🗺️ Fluxo rápido
1) Serviços/preço → list_services → “Qual você quer marcar?”
2) Para agendar: serviço + dia + hora + preferência de barbeiro (se houver)
3) Com dia/hora → check_availability (obrigatório). Só sugira outro horário se a ferramenta disser que não tem vaga.
4) Confirmação final (curta): “Serviço • dia/hora • barbeiro. Fecho assim?”
5) Confirmou → create_appointment → mensagem curta: “Agendamento confirmado: [resumo]. Aguardamos você!” (evite “Seu agendamento está marcado para” e “Te vejo lá!”).`;

const RUNTIME_GUARDRAILS = `GUARDRAILS (obrigatório, acima de qualquer prompt customizado):
- Direcione qualquer contato para agendamento (serviços ou marcar horário).
- Em cumprimento curto, use a abertura obrigatória com “Quer ver os serviços ou já quer agendar? ✂️”.
- Proibido responder com frases genéricas (“Como posso ajudar?”, “Estou aqui para ajudar”).
- Emojis: não use em toda mensagem. Em geral: 0–1 por mensagem, e evite repetir.
- Serviço que não existe: chame list_services e responda com lista dos principais + “Gostaria de agendar um horário ou ver outras opções?”
- Nunca sugerir horário no passado. Para “hoje” sem hora ou “primeiro horário”/“primeiro horário amanhã”: use get_next_slots (com after_time quando for hoje).
- Se o cliente já informou DIA/HORÁRIO, NÃO mude. Só sugira outro horário se houver conflito ao checar disponibilidade.
- “Qualquer um / tanto faz”: SEM preferência; escolha você um barbeiro disponível.
- Nunca diga “tá agendado / tá marcado” antes de create_appointment retornar sucesso.
- Fechamento após agendar: “Agendamento confirmado: … Aguardamos você!” (mensagens curtas).
- Nunca pedir telefone. Nunca mostrar IDs/UUIDs.`;

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_services",
      description: "Lista os serviços da barbearia (nome, valor, descrição).",
    },
  },
  {
    type: "function",
    function: {
      name: "list_barbers",
      description: "Lista os barbeiros disponíveis.",
    },
  },
  {
    type: "function",
    function: {
      name: "list_appointments",
      description: "Lista agendamentos por data para verificar horários ocupados. Use antes de confirmar um agendamento.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato yyyy-MM-dd" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Checa se há barbeiro disponível em uma data/hora para um serviço (considera expediente e conflitos). Para HOJE, passe after_time com o horário atual para não sugerir horários no passado.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato yyyy-MM-dd" },
          time: { type: "string", description: "Horário no formato HH:mm" },
          after_time: { type: "string", description: "Para data de hoje: horário mínimo (HH:mm). Use o horário atual do contexto." },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          service_id: { type: "string", description: "UUID do serviço (opcional)" },
          service_ids: { type: "array", items: { type: "string" }, description: "UUIDs de serviços (opcional, para múltiplos)" },
        },
        required: ["date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_next_slots",
      description:
        "Retorna os próximos horários disponíveis em uma data (primeiros N slots). Use para 'primeiro horário', 'hoje' ou 'amanhã' sem hora específica. Para HOJE passe after_time com o horário atual.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data yyyy-MM-dd" },
          service_id: { type: "string", description: "UUID do serviço (ou use service_ids)" },
          service_ids: { type: "array", items: { type: "string" }, description: "UUIDs de serviços (opcional)" },
          after_time: { type: "string", description: "Quando a data for hoje: horário mínimo HH:mm (use o horário atual do contexto)" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          limit: { type: "number", description: "Máximo de slots a retornar (padrão 10)" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_client",
      description: "Buscar ou criar cliente por telefone. Retorna id, name, phone.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Telefone do cliente" },
          name: { type: "string", description: "Nome do cliente" },
          notes: { type: "string", description: "Observações" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description: "Cria um novo agendamento. Só chame após confirmação explícita do cliente.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do topo)" },
          client_name: { type: "string", description: "Nome do cliente (opcional)" },
          barber_id: { type: "string", description: "ID do barbeiro (UUID)" },
          service_id: { type: "string", description: "ID do serviço (UUID)" },
          service_ids: { type: "array", items: { type: "string" }, description: "IDs de serviços (opcional, use para múltiplos)" },
          date: { type: "string", description: "Data yyyy-MM-dd" },
          time: { type: "string", description: "Horário HH:mm" },
          notes: { type: "string", description: "Observações" },
        },
        required: ["client_phone", "barber_id", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_upcoming_appointments",
      description: "Lista os próximos agendamentos do cliente (pelo telefone). Use quando o cliente quiser cancelar ou reagendar.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
        },
        required: ["client_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela um agendamento. Use o id retornado por list_client_upcoming_appointments e o telefone do cliente.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "UUID do agendamento" },
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
        },
        required: ["appointment_id", "client_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description: "Reagenda um agendamento para nova data/hora. Use check_availability antes se precisar validar horário. Use o telefone do cliente.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "UUID do agendamento" },
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
          date: { type: "string", description: "Nova data yyyy-MM-dd" },
          time: { type: "string", description: "Novo horário HH:mm" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
        },
        required: ["appointment_id", "client_phone", "date", "time"],
      },
    },
  },
];

const MAX_MEMORY_MESSAGES = 30;

export type AgentResult = {
  reply: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  state?: "appointment_created" | "handoff_requested";
};

export type RunAgentOptions = {
  /** When set, use this profile/instructions instead of DB (e.g. for sandbox simulation). */
  sandboxDraft?: { agent_profile: unknown; additional_instructions?: string | null };
};

export async function runAgent(
  barbershopId: string,
  conversationId: string,
  clientPhone: string,
  openai: OpenAI,
  options?: RunAgentOptions
): Promise<AgentResult> {
  const settingsRow = await pool.query<{
    enabled: boolean;
    timezone: string | null;
    model: string;
    model_premium: string | null;
    temperature: number;
    system_prompt_override: string | null;
    agent_profile: unknown;
    additional_instructions: string | null;
  }>(
    `SELECT s.enabled, s.timezone, s.model, s.model_premium, s.temperature, s.system_prompt_override,
            s.agent_profile, s.additional_instructions
     FROM public.barbershop_ai_settings s WHERE s.barbershop_id = $1`,
    [barbershopId]
  );
  const settings = settingsRow.rows[0];
  const planRow = await pool.query<{ billing_plan: string | null }>(
    "SELECT billing_plan FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  const billingPlan = planRow.rows[0]?.billing_plan ?? "pro";
  const msgCountRow = await pool.query<{ cnt: string }>(
    "SELECT count(*)::text AS cnt FROM public.ai_messages WHERE conversation_id = $1",
    [conversationId]
  );
  const messageCount = parseInt(msgCountRow.rows[0]?.cnt ?? "0", 10);
  const ESCALATION_MESSAGE_THRESHOLD = 15;
  const ESCALATION_TOOL_ERROR_THRESHOLD = 2;
  const premiumAvailable =
    billingPlan === "premium" && (settings?.model_premium ?? "").trim() !== "";
  const usePremiumByMessages =
    premiumAvailable && messageCount >= ESCALATION_MESSAGE_THRESHOLD;
  let usePremiumModel = usePremiumByMessages;
  let model = usePremiumModel ? (settings?.model_premium ?? settings?.model) : (settings?.model ?? "gpt-4o-mini");
  const temperature = settings?.temperature ?? 0.7;
  const draft = options?.sandboxDraft;
  const useDraft = draft && draft.agent_profile != null && typeof draft.agent_profile === "object";
  const hasProfile =
    useDraft ||
    (settings?.agent_profile != null &&
      typeof settings.agent_profile === "object" &&
      Object.keys(settings.agent_profile as object).length > 0);
  let systemPrompt: string;
  if (hasProfile) {
    const profile = useDraft ? normalizeProfile(draft.agent_profile) : normalizeProfile(settings!.agent_profile);
    const additionalInstructions = useDraft ? (draft.additional_instructions ?? null) : (settings?.additional_instructions ?? null);
    systemPrompt = buildSystemPrompt({
      basePrompt: DEFAULT_SYSTEM_PROMPT,
      guardrails: RUNTIME_GUARDRAILS,
      profile,
      additionalInstructions,
    });
  } else {
    systemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (settings?.system_prompt_override) {
      systemPrompt =
        systemPrompt +
        "\n\nPROMPT CUSTOMIZADO (complementar; não substitui regras/guardrails):\n" +
        settings.system_prompt_override;
    }
  }

  const nameRow = await pool.query<{ name: string }>(
    "SELECT name FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  const barbershopName = nameRow.rows[0]?.name ?? "Barbearia";
  // Safety: ensure we always use a real IANA timezone (avoid drifting to UTC in production).
  const timeZone = settings?.timezone && settings.timezone.includes("/") ? settings.timezone : "America/Sao_Paulo";
  const now = new Date();
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
  const tomorrowOnlyStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const currentTimeHHmm = (dateTimeStr.includes(" ") ? dateTimeStr.split(" ")[1] : "00:00").slice(0, 5);

  // Always resolve client by the incoming phone so we never ask for it.
  let clientName = "";
  try {
    const c = (await aiTools.upsertClient(barbershopId, clientPhone)) as unknown;
    if (c && typeof c === "object") {
      const maybeName = (c as Record<string, unknown>).name;
      if (typeof maybeName === "string" && maybeName.trim() && maybeName.trim().toLowerCase() !== "cliente") {
        clientName = maybeName.trim();
      }
    }
  } catch {
    // If client lookup fails, the agent can still proceed by asking name later (never phone).
  }
  if (!hasProfile) {
    systemPrompt = systemPrompt + "\n\n" + RUNTIME_GUARDRAILS;
  }
  systemPrompt = systemPrompt
    .replace(/\{\{TIMEZONE\}\}/g, timeZone)
    .replace(/\{\{DATE_NOW\}\}/g, dateTimeStr)
    .replace(/\{\{TODAY_DATE\}\}/g, dateOnlyStr)
    .replace(/\{\{TOMORROW_DATE\}\}/g, tomorrowOnlyStr)
    .replace(/\{\{CLIENT_PHONE\}\}/g, clientPhone)
    .replace(/\{\{CLIENT_NAME\}\}/g, clientName || "")
    .replace(/\{\{BARBERSHOP_NAME\}\}/g, barbershopName);

  const messagesRow = await pool.query<{
    role: string;
    content: string | null;
    tool_name: string | null;
    tool_payload: unknown;
  }>(
    `SELECT role, content, tool_name, tool_payload FROM public.ai_messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  const history = messagesRow.rows;
  const lastN = history.slice(-MAX_MEMORY_MESSAGES);
  const lastUserText =
    [...lastN].reverse().find((m) => m.role === "user")?.content?.toLowerCase().trim() ?? "";

  const desired = (() => {
    let desiredDate: string | undefined;
    let desiredTime: string | undefined;
    const year = dateOnlyStr.slice(0, 4);

    function normalizeTime(hRaw: string, mRaw?: string): string | undefined {
      const h = parseInt(hRaw, 10);
      const m = mRaw == null || mRaw === "" ? 0 : parseInt(mRaw, 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;
      if (h < 0 || h > 23 || m < 0 || m > 59) return;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    for (const m of [...lastN].reverse()) {
      if (m.role !== "user") continue;
      const t = (m.content ?? "").toLowerCase();

      if (!desiredDate) {
        if (t.includes("amanh")) desiredDate = tomorrowOnlyStr;
        else if (t.includes("hoje")) desiredDate = dateOnlyStr;
        else if (t.includes("agora")) desiredDate = dateOnlyStr;
        else {
          const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
          if (iso?.[1]) desiredDate = iso[1];
          else {
            const br = t.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
            if (br?.[1] && br?.[2]) {
              const dd = String(parseInt(br[1], 10)).padStart(2, "0");
              const mm = String(parseInt(br[2], 10)).padStart(2, "0");
              desiredDate = `${year}-${mm}-${dd}`;
            }
          }
        }
      }

      if (!desiredTime) {
        const as = t.match(/\b(?:às|as|a)\s*(\d{1,2})(?::(\d{2}))?\b/);
        const h = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*h\b/);
        const direct = t.match(/\b(\d{1,2}):(\d{2})\b/);
        if (as?.[1]) desiredTime = normalizeTime(as[1], as[2]);
        else if (h?.[1]) desiredTime = normalizeTime(h[1], h[2]);
        else if (direct?.[1] && direct?.[2]) desiredTime = normalizeTime(direct[1], direct[2]);
      }

      if (desiredDate && desiredTime) break;
    }

    // If user gave only a time, assume today if it's still in the future; otherwise tomorrow.
    if (!desiredDate && desiredTime) {
      const tm = (() => {
        const [hh, mm] = desiredTime.split(":");
        return parseInt(hh, 10) * 60 + parseInt(mm, 10);
      })();
      const nowM = (() => {
        const [hh, mm] = currentTimeHHmm.split(":");
        return parseInt(hh, 10) * 60 + parseInt(mm, 10);
      })();
      desiredDate = tm >= nowM + 10 ? dateOnlyStr : tomorrowOnlyStr;
    }

    return { desiredDate, desiredTime };
  })();

  const bookingGuard =
    desired.desiredDate || desired.desiredTime
      ? `\n\nDADOS JÁ INFORMADOS PELO CLIENTE (não invente e não mude):\n- date=${desired.desiredDate ?? "(não informado)"}\n- time=${desired.desiredTime ?? "(não informado)"}\nSe precisar sugerir alternativa, só faça isso se o horário estiver ocupado após checar disponibilidade.`
      : "";

  systemPrompt = systemPrompt + bookingGuard;
  const shouldPreferNameStep =
    !clientName && !!desired.desiredDate && !!desired.desiredTime
      ? `\n\nFECHAMENTO EM 2 MENSAGENS (obrigatório quando não há nome):\n` +
        `- Use o delimitador [[MSG]] para mandar 2 mensagens.\n` +
        `- Msg 1: resumo do agendamento + valor total (do check_availability) + barbeiro + data/hora.\n` +
        `- Msg 2: peça o nome para salvar.\n` +
        `- Quando o cliente responder com o nome, chame create_appointment sem pedir confirmação de novo.`
      : "";
  systemPrompt = systemPrompt + shouldPreferNameStep;
  const isGreetingOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    // Short greetings: oi/olá/salve/bom dia/boa tarde/boa noite/opa/e aí
    if (t.length > 40) return false;
    return /^(oi|ola|olá|opa|salve|e\s*a[ií]|bom dia|boa tarde|boa noite|fala|iae|iai|oii+|olaa+)[!.\s]*$/.test(
      t
    );
  })();

  // --- Deterministic guardrails (runtime), to avoid generic/robotic behavior ---
  // 1) Strong opening for short greetings.
  if (isGreetingOnly) {
    const reply = OPENING_MESSAGE;
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      conversationId,
      reply,
    ]);
    return { reply };
  }

  // 2) Out-of-scope (pizza etc.): never invent external businesses; redirect to booking/services.
  if (isOutOfScopeFood(lastUserText)) {
    const reply = "Aqui eu só cuido do visual 😄\n\nQuer ver os serviços ou já quer agendar um horário?";
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      conversationId,
      reply,
    ]);
    return { reply };
  }

  // 3) If user asks “vocês tem X?” and X doesn't exist, list top services immediately + CTA.
  if (/(voc[eê]s\s+t[eê]m|voces\s+tem|fazem|faz)\b/i.test(lastUserText)) {
    const asked = extractAskedService(lastUserText);
    if (asked) {
      const servicesUnknown = await aiTools.listServices(barbershopId);
      const services = Array.isArray(servicesUnknown) ? (servicesUnknown as any[]) : [];
      const askedN = normalizeLoose(asked);
      const has = services.some((s) => normalizeLoose(String(s?.name ?? "")).includes(askedN) || askedN.includes(normalizeLoose(String(s?.name ?? ""))));
      if (!has) {
        const top = services
          .map((s) => ({
            name: String(s?.name ?? ""),
            price: Number(s?.price ?? 0),
            duration_minutes: Number(s?.duration_minutes ?? 0),
          }))
          .filter((s) => s.name);
        const reply =
          `Não temos *${asked}* aqui 😅\n\n` +
          `Mas a gente faz:\n` +
          `${formatTopServicesForWhatsapp(top, 4)}\n\n` +
          `Gostaria de agendar um horário ou ver outras opções?`;
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
        return { reply };
      }
    }
  }

  // 3.1) If user says "qualquer um" (or "sim" after options), assume no preference and advance when we already have date+time.
  const userSaidNoPreference = /(qualquer um|tanto faz|pode ser qualquer)/i.test(lastUserText);
  const userIsAffirmativeOnly =
    /^(sim|s|pode|ok|okay|beleza|confirmo|isso|fechado|combinado|manda ver|top|show)[!.\s]*$/i.test((lastUserText ?? "").trim());
  const assistantAskedPreference = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(qual .*você prefere|qual .*prefere|prefere qual|quer qual)/i.test(t);
    }
    return false;
  })();

  if ((userSaidNoPreference || (userIsAffirmativeOnly && assistantAskedPreference)) && desired.desiredDate && desired.desiredTime) {
    const servicesUnknown = await aiTools.listServices(barbershopId);
    const services = Array.isArray(servicesUnknown) ? (servicesUnknown as any[]) : [];
    const historyUserText = normalizeLoose(
      lastN
        .filter((m) => m.role === "user")
        .map((m) => String(m.content ?? ""))
        .join(" ")
    );
    const pickedService = services.find((s) => {
      const n = normalizeLoose(String(s?.name ?? ""));
      return n && historyUserText.includes(n);
    });

    if (pickedService) {
      const availability = (await aiTools.checkAvailability(barbershopId, {
        date: desired.desiredDate,
        time: desired.desiredTime,
        service_id: String(pickedService.id),
        after_time: desired.desiredDate ? undefined : undefined,
      })) as any;

      const barbers = Array.isArray(availability?.requested?.barbers) ? availability.requested.barbers : [];
      if (availability?.requested?.available && barbers.length) {
        const chosen = barbers[0];
        const reply =
          `Show — vou te colocar com o *${chosen.barber_name}* então.\n\n` +
          `*${String(pickedService.name)}* • ${desired.desiredDate} ${desired.desiredTime} • *R$ ${Number(availability.total_price ?? 0).toFixed(2).replace(".", ",")}*` +
          `\n\n[[MSG]]Pra salvar aqui, qual seu nome?`;
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
        return { reply };
      }
    }
    // If we can't resolve service or can't fit, fall back to the model flow.
  }

  // 4) When user asks for times “today” without a specific time, force get_next_slots with after_time.
  if (
    /\bhoje\b/i.test(lastUserText) &&
    /(hor[aá]rio|tem hor[aá]rio|dispon[ií]vel|vaga)/i.test(lastUserText) &&
    !desired.desiredTime
  ) {
    const servicesUnknown = await aiTools.listServices(barbershopId);
    const services = Array.isArray(servicesUnknown) ? (servicesUnknown as any[]) : [];
    const inferred = inferServiceKeyword(lastUserText);
    const findBy = (needle: string) => services.find((s) => normalizeLoose(String(s?.name ?? "")).includes(needle));
    const picked =
      inferred === "combo"
        ? findBy("corte + barba") ?? findBy("corte") ?? services[0]
        : inferred === "barba"
          ? findBy("barba") ?? services[0]
          : inferred === "sobrancelha"
            ? findBy("sobrancelha") ?? services[0]
            : inferred === "corte"
              ? findBy("corte") ?? services[0]
              : null;

    if (!picked) {
      const top = services
        .map((s) => ({ name: String(s?.name ?? ""), price: Number(s?.price ?? 0), duration_minutes: Number(s?.duration_minutes ?? 0) }))
        .filter((s) => s.name);
      const reply =
        `Fechou — pra qual serviço você quer? 👀\n\n` +
        `Aqui os principais:\n` +
        `${formatTopServicesForWhatsapp(top, 4)}\n\n` +
        `Me diz qual você quer que eu já puxo os horários de hoje.`;
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
      return { reply };
    }

    const slots = (await aiTools.getNextSlots(barbershopId, {
      date: dateOnlyStr,
      service_id: String(picked.id),
      after_time: currentTimeHHmm,
      limit: 3,
    })) as any;

    const times: string[] = Array.isArray(slots?.slots)
      ? slots.slots.map((s: any) => String(s?.time ?? "")).filter(Boolean)
      : [];

    if (times.length) {
      const reply = `Hoje eu consigo te encaixar nesses horários: *${times.join("* • *")}*.\nQual você prefere?`;
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
      return { reply };
    }

    const reply = "Hoje já tá bem corrido por aqui 😅 Quer que eu veja o primeiro horário de amanhã?";
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      conversationId,
      reply,
    ]);
    return { reply };
  }

  // 5) "Primeiro horário amanhã" should always be computed (never guessed).
  if (
    /\bamanh/i.test(lastUserText) &&
    /(primeiro|1o|primeira)\s+hor[aá]rio/i.test(lastUserText) &&
    !desired.desiredTime
  ) {
    const servicesUnknown = await aiTools.listServices(barbershopId);
    const services = Array.isArray(servicesUnknown) ? (servicesUnknown as any[]) : [];
    const inferred = inferServiceKeyword(lastUserText);
    const findBy = (needle: string) => services.find((s) => normalizeLoose(String(s?.name ?? "")).includes(needle));
    const picked =
      inferred === "combo"
        ? findBy("corte + barba") ?? findBy("corte") ?? services[0]
        : inferred === "barba"
          ? findBy("barba") ?? services[0]
          : inferred === "sobrancelha"
            ? findBy("sobrancelha") ?? services[0]
            : inferred === "corte"
              ? findBy("corte") ?? services[0]
              : null;

    if (!picked) {
      const top = services
        .map((s) => ({ name: String(s?.name ?? ""), price: Number(s?.price ?? 0), duration_minutes: Number(s?.duration_minutes ?? 0) }))
        .filter((s) => s.name);
      const reply =
        `Pra qual serviço você quer marcar amanhã?\n\n` +
        `Aqui os principais:\n` +
        `${formatTopServicesForWhatsapp(top, 4)}`;
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
      return { reply };
    }

    const slots = (await aiTools.getNextSlots(barbershopId, {
      date: tomorrowOnlyStr,
      service_id: String(picked.id),
      limit: 1,
    })) as any;
    const first = Array.isArray(slots?.slots) && slots.slots[0] ? slots.slots[0] : null;
    const t = first?.time ? String(first.time) : null;
    const reply = t ? `Amanhã o primeiro horário que eu tenho é *${t}*. Quer esse?` : "Amanhã tá bem cheio 😅 Quer tentar outro dia?";
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      conversationId,
      reply,
    ]);
    return { reply };
  }

  const isAffirmativeOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    if (t.length > 40) return false;
    return /^(sim|s|pode|ok|okay|beleza|confirmo|isso|fechado|combinado|manda ver|pode agendar|pode marcar|top|show)[!.\s]*$/i.test(t);
  })();

  const assistantAskedConfirmation = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(fecho assim|confirma|posso fechar|t[aá] tudo certo|pode prosseguir|posso prosseguir|confirma pra mim)/i.test(t);
    }
    return false;
  })();

  const assistantAskedName = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(qual seu nome|me diz seu nome|seu nome pra salvar|pra salvar.*nome)/i.test(t);
    }
    return false;
  })();

  const isLikelyNameOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    if (t.length < 2 || t.length > 40) return false;
    // avoid treating affirmations as names
    if (isAffirmativeOnly) return false;
    if (isGreetingOnly) return false;
    // mostly letters/spaces (allow accents)
    return /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(t) && t.split(" ").filter(Boolean).length <= 4;
  })();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(isGreetingOnly
      ? ([
          {
            role: "system",
            content:
              "ABERTURA OBRIGATÓRIA: como primeira resposta a um cumprimento curto, responda exatamente neste estilo (pode variar 1–2 palavras, mas mantenha direção e emojis):\n" +
              "“Salve! 😄 Bora deixar o visual na régua? Quer ver os serviços ou já quer agendar? ✂️”\n" +
              "Não use mensagens genéricas tipo “Como posso te ajudar?” nem “Estou aqui para ajudar”.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isAffirmativeOnly && assistantAskedConfirmation
      ? ([
          {
            role: "system",
            content:
              "CONFIRMAÇÃO RECEBIDA: o cliente confirmou. Agora você DEVE finalizar o agendamento.\n" +
              "- Se faltar qualquer dado/ID: use tools (list_services, list_barbers, check_availability) para resolver.\n" +
              "- Em seguida, chame create_appointment.\n" +
              "- Não peça confirmação de novo. Não diga que está agendado antes do create_appointment retornar sucesso.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isLikelyNameOnly && assistantAskedName
      ? ([
          {
            role: "system",
            content:
              "NOME RECEBIDO: use esse nome como client_name e finalize o agendamento agora.\n" +
              "- Não peça confirmação novamente.\n" +
              "- Chame create_appointment.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...lastN
      .map((m) => {
        if (m.role === "user") return { role: "user" as const, content: m.content ?? "" };
        if (m.role === "assistant") return { role: "assistant" as const, content: m.content ?? "" };
        // Tool messages cannot be replayed safely across turns (tool_call_id mismatch); skip them.
        return null;
      })
      .filter(Boolean) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ];

  let state: AgentResult["state"];
  let totalUsage: AgentResult["usage"];
  const loopMessages = [...messages];
  const maxToolRounds = 10;
  let toolErrorCount = 0;

  async function persistAssistant(content: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [conversationId, stripIdsAndUuids(content ?? "")]
    );
  }
  async function persistTool(toolName: string, payload: unknown, content: string): Promise<void> {
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content) VALUES ($1, 'tool', $2, $3, $4)`,
      [conversationId, toolName, JSON.stringify(payload), content.slice(0, 8192)]
    );
  }

  for (let round = 0; round < maxToolRounds; round++) {
    const completion = await openai.chat.completions.create({
      model,
      temperature,
      messages: loopMessages,
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    });
    const choice = completion.choices[0];
    if (completion.usage) {
      totalUsage = {
        prompt_tokens: completion.usage.prompt_tokens ?? 0,
        completion_tokens: completion.usage.completion_tokens ?? 0,
        total_tokens: completion.usage.total_tokens ?? 0,
      };
    }
    if (!choice) {
      return {
        reply: "Desculpe, não consegui processar. Tente de novo em instantes.",
        usage: totalUsage,
      };
    }
    const msg = choice.message;
    if (msg.tool_calls?.length) {
      await persistAssistant(msg.content ?? null);
      // IMPORTANT: push the assistant tool_calls message exactly once, then add one tool response per tool_call_id.
      // If we push the assistant message multiple times (once per tool), OpenAI rejects the sequence.
      loopMessages.push(msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);
      for (const tc of msg.tool_calls) {
        const fn = "function" in tc ? (tc as { function?: { name?: string; arguments?: string } }).function : undefined;
        const name = fn?.name as string;
        const args = (() => {
          try {
            return JSON.parse(fn?.arguments ?? "{}") as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        const callToolOnce = async (): Promise<unknown> => {
          if (name === "list_services") return aiTools.listServices(barbershopId);
          if (name === "list_barbers") return aiTools.listBarbers(barbershopId);
          if (name === "list_appointments")
            return aiTools.listAppointments(
              barbershopId,
              (() => {
                const raw = (args.date as string) ?? "";
                const d = raw || desired.desiredDate || "";
                if (desired.desiredDate && d !== desired.desiredDate) return desired.desiredDate;
                if (lastUserText.includes("amanh") && d && d !== tomorrowOnlyStr) return tomorrowOnlyStr;
                if (lastUserText.includes("hoje") && d && d !== dateOnlyStr) return dateOnlyStr;
                return d;
              })(),
              args.barber_id as string | undefined
            );
          if (name === "check_availability") {
            const dRaw = (args.date as string) ?? "";
            const tRaw = (args.time as string) ?? "";
            const date = desired.desiredDate || dRaw;
            const time = desired.desiredTime || tRaw;
            const isToday = date === dateOnlyStr;
            return aiTools.checkAvailability(barbershopId, {
              date,
              time,
              after_time: isToday ? ((args.after_time as string) || currentTimeHHmm) : undefined,
              barber_id: args.barber_id as string | undefined,
              service_id: args.service_id as string | undefined,
              service_ids: args.service_ids as string[] | undefined,
            });
          }
          if (name === "get_next_slots") {
            const dRaw = (args.date as string) ?? "";
            const date = desired.desiredDate || dRaw;
            const isToday = date === dateOnlyStr;
            return aiTools.getNextSlots(barbershopId, {
              date,
              service_id: args.service_id as string | undefined,
              service_ids: args.service_ids as string[] | undefined,
              after_time: isToday ? ((args.after_time as string) || currentTimeHHmm) : undefined,
              barber_id: args.barber_id as string | undefined,
              limit: typeof args.limit === "number" ? args.limit : undefined,
            });
          }
          if (name === "upsert_client")
            return aiTools.upsertClient(
              barbershopId,
              (args.phone as string) ?? "",
              args.name as string | undefined,
              args.notes as string | undefined
            );
          if (name === "create_appointment") {
            const payload: Parameters<typeof aiTools.createAppointment>[1] = {
              client_phone: (args.client_phone as string) ?? clientPhone,
              client_name: args.client_name as string | undefined,
              barber_id: args.barber_id as string,
              service_id: args.service_id as string | undefined,
              service_ids: args.service_ids as string[] | undefined,
              date: (() => {
                const raw = (args.date as string) ?? "";
                const d = raw || desired.desiredDate || "";
                if (desired.desiredDate && d !== desired.desiredDate) return desired.desiredDate;
                if (lastUserText.includes("amanh") && d && d !== tomorrowOnlyStr) return tomorrowOnlyStr;
                if (lastUserText.includes("hoje") && d && d !== dateOnlyStr) return dateOnlyStr;
                return d;
              })(),
              time: (() => {
                const raw = (args.time as string) ?? "";
                const t = raw || desired.desiredTime || "";
                if (desired.desiredTime && t !== desired.desiredTime) return desired.desiredTime;
                return t;
              })(),
              notes: args.notes as string | undefined,
            };
            if (typeof args.client_id === "string" && args.client_id) payload.client_id = args.client_id;
            const r = await aiTools.createAppointment(barbershopId, payload);
            state = "appointment_created";
            return r;
          }
          if (name === "list_client_upcoming_appointments")
            return aiTools.listClientUpcomingAppointments(
              barbershopId,
              ((args.client_phone as string) ?? clientPhone) || ""
            );
          if (name === "cancel_appointment")
            return aiTools.cancelAppointmentByAgent(
              barbershopId,
              (args.appointment_id as string) ?? "",
              ((args.client_phone as string) ?? clientPhone) || ""
            );
          if (name === "reschedule_appointment")
            return aiTools.rescheduleAppointmentByAgent(
              barbershopId,
              (args.appointment_id as string) ?? "",
              ((args.client_phone as string) ?? clientPhone) || "",
              {
                date: (args.date as string) ?? "",
                time: (args.time as string) ?? "",
                barber_id: args.barber_id as string | undefined,
              }
            );
          return { error: "Unknown tool" };
        };

        let result: unknown;
        try {
          result = await callToolOnce();
        } catch (e1) {
          // One retry for transient connectivity/DB hiccups.
          try {
            result = await callToolOnce();
          } catch (e2) {
            result = { error: e2 instanceof Error ? e2.message : "Tool error" };
          }
        }
        if (
          result != null &&
          typeof result === "object" &&
          "error" in result &&
          (result as { error?: unknown }).error
        ) {
          toolErrorCount++;
        }
        const content = JSON.stringify(result).slice(0, 4096);
        await persistTool(name, args, content);
        loopMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }
      if (
        premiumAvailable &&
        !usePremiumModel &&
        toolErrorCount >= ESCALATION_TOOL_ERROR_THRESHOLD
      ) {
        usePremiumModel = true;
        model = settings?.model_premium ?? settings?.model ?? model;
      }
      continue;
    }
    const replyRaw = (msg.content ?? "").trim() || "Desculpe, não consegui responder. Pode repetir?";
    let reply = stripIdsAndUuids(replyRaw);
    if (looksLikePhoneRequest(reply)) {
      reply = "Fechou! Me diz qual serviço você quer e pra qual dia/horário — que eu já te encaixo.";
    }
    await persistAssistant(reply);
    return { reply, usage: totalUsage, state };
  }

  return {
    reply: "Limite de etapas atingido. Resuma o que precisa e eu te ajudo.",
    usage: totalUsage,
    state,
  };
}
