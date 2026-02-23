/**
 * Demo agent flow: given state + user message, produce reply (message, suggestions, trace, new state).
 * Zero LLM; policy and slot-filling only.
 */

import type {
  DemoCatalog,
  DemoSessionState,
  DemoAgentReply,
  DemoTraceEvent,
  DemoUiHints,
  DemoProgressStage,
} from "./types";
import {
  normalizeLoose,
  inferServiceKeyword,
  isGreeting,
  isOutOfScope,
  isNoPreference,
  isAffirmative,
  isLikelyName,
  parseDate,
  parseTime,
  detectIntent,
  hasBookingIntent,
  isUnclear,
} from "./nlu";
import * as tools from "./tools";
import { DEFAULT_DEMO_CATALOG } from "./catalog";

const OPENING_MESSAGE =
  "Salve! 😄 Bora deixar na régua? Quer ver os serviços ou já quer agendar? ✂️";

const MAX_TURNS = 20;
const MAX_MESSAGE_LENGTH = 400;
const OUT_OF_SCOPE_STRIKES_THRESHOLD = 2;
const LAYER1_UNCLEAR_MESSAGE =
  "Não entendi — você quer *ver serviços* ou *agendar um horário*?";
const LAYER1_CHIPS = ["Ver serviços", "Quero agendar"];
const RESET_MESSAGE =
  "Aqui eu só consigo falar de agendamento. 🙂 Ex.: \"Quero um corte\", \"Amanhã 10h\", \"Ver serviços\". Começando de novo.";
const RESET_CHIPS = ["Ver serviços", "Quero um corte", "Começar de novo"];

/** Build UI hints from current state for placeholder, progress, examples. Exported for UI. */
export function getUiHints(state: DemoSessionState): DemoUiHints {
  let stage: DemoProgressStage = "service";
  let progressStep = 0;
  let placeholder = "Ex.: Quero corte + barba";
  let helperExamples = ["Corte", "Barba", "Corte + Barba", "Ver serviços"];

  if (state.appointmentCreated) {
    stage = "final";
    progressStep = 4;
    placeholder = "";
    helperExamples = [];
  } else if (state.lastBotQuestion === "name" || (state.lastBotQuestion === "confirm" && state.clientName === null)) {
    stage = "confirm";
    progressStep = 3;
    placeholder = "Ex.: sim / confirmo ou seu nome";
    helperExamples = ["Sim", "Confirmo"];
  } else if (state.serviceIds.length && state.date && !state.time) {
    stage = "time";
    progressStep = 2;
    placeholder = "Ex.: 10h / 14:30";
    helperExamples = ["10:00", "14:00", "15:30", "Outro dia"];
  } else if (state.serviceIds.length && !state.date) {
    stage = "date";
    progressStep = 1;
    placeholder = "Ex.: Amanhã / 12/03";
    helperExamples = ["Hoje", "Amanhã", "Sexta", "Sábado"];
  } else if (state.serviceIds.length && state.date && state.time && state.barberId) {
    stage = "confirm";
    progressStep = 3;
    placeholder = "Ex.: sim / confirmo";
    helperExamples = ["Sim", "Confirmo", "Qualquer um"];
  } else if (state.serviceIds.length) {
    stage = "service";
    progressStep = 0;
    placeholder = "Ex.: Quero corte + barba";
    helperExamples = ["Corte", "Barba", "Corte + Barba"];
  }

  return { stage, placeholder, helperExamples, progressStep };
}

export function createInitialState(): DemoSessionState {
  return {
    intent: "unknown",
    serviceIds: [],
    barberId: null,
    date: null,
    time: null,
    clientName: null,
    turnsUsed: 0,
    lastBotQuestion: null,
    outOfScopeStrikes: 0,
    appointmentCreated: false,
  };
}

function formatServicesList(catalog: DemoCatalog, max = 4): string {
  return catalog.services
    .slice(0, max)
    .map(
      (s, i) =>
        `${i + 1}. *${s.name}* - R$ ${s.price.toFixed(2).replace(".", ",")} (${s.durationMinutes} min)`
    )
    .join("\n");
}

/** Resolve service IDs from text (keyword or "primeiro" = first service). */
function resolveServiceIds(
  catalog: DemoCatalog,
  text: string,
  currentIds: string[]
): string[] {
  if (currentIds.length) return currentIds;
  const kw = inferServiceKeyword(text);
  if (kw === "combo") {
    const combo = catalog.services.find((s) =>
      normalizeLoose(s.name).includes("corte") && normalizeLoose(s.name).includes("barba")
    );
    if (combo) return [combo.id];
    return [catalog.services[0].id, catalog.services[1].id];
  }
  if (kw === "corte") {
    const c = catalog.services.find((s) => normalizeLoose(s.name).includes("corte") && !normalizeLoose(s.name).includes("barba"));
    return c ? [c.id] : [catalog.services[0].id];
  }
  if (kw === "barba") {
    const b = catalog.services.find((s) => normalizeLoose(s.name).includes("barba") && !normalizeLoose(s.name).includes("corte"));
    return b ? [b.id] : [catalog.services[1].id];
  }
  if (kw === "sobrancelha") {
    const s = catalog.services.find((s) => normalizeLoose(s.name).includes("sobrancelha"));
    return s ? [s.id] : [catalog.services[0].id];
  }
  if (/primeiro|primeira|numero 1|1\b/.test(normalizeLoose(text))) {
    return [catalog.services[0].id];
  }
  return [];
}

export function runDemoAgent(
  userMessage: string,
  state: DemoSessionState,
  catalog: DemoCatalog = DEFAULT_DEMO_CATALOG,
  refDate: Date = new Date(),
  sessionSeed?: number
): DemoAgentReply {
  const trace: DemoTraceEvent[] = [];
  const suggestions: string[] = [];
  let message = "";
  let nextState = { ...state };

  const trimmed = userMessage.slice(0, MAX_MESSAGE_LENGTH).trim();
  if (!trimmed) {
    return {
      message: "Manda uma mensagem pra gente continuar 😄",
      suggestions: ["Ver serviços", "Quero agendar"],
      trace: [],
      state: nextState,
      reset: false,
      appointmentCreated: false,
      uiHints: getUiHints(nextState),
    };
  }

  nextState.turnsUsed += 1;
  if (nextState.turnsUsed > MAX_TURNS) {
    return {
      message:
        "Chegamos no limite da simulação. No produto real não tem limite! Quer assinar e testar no seu WhatsApp?",
      suggestions: ["Assinar agora", "Ver planos"],
      trace: [],
      state: nextState,
      reset: false,
      appointmentCreated: false,
      uiHints: getUiHints(nextState),
    };
  }

  // --- Layer 1 (não entendi) vs Layer 2 (reset): out-of-scope or unclear ---
  const isUnclearMessage = isUnclear(trimmed);
  if (isOutOfScope(trimmed) || isUnclearMessage) {
    nextState.outOfScopeStrikes += 1;
    if (nextState.outOfScopeStrikes >= OUT_OF_SCOPE_STRIKES_THRESHOLD) {
      const fresh = createInitialState();
      return {
        message: RESET_MESSAGE,
        suggestions: RESET_CHIPS,
        trace: [],
        state: fresh,
        reset: true,
        appointmentCreated: false,
        uiHints: getUiHints(fresh),
      };
    }
    return {
      message: LAYER1_UNCLEAR_MESSAGE,
      suggestions: LAYER1_CHIPS,
      trace: [],
      state: nextState,
      reset: false,
      appointmentCreated: false,
      uiHints: getUiHints(nextState),
    };
  }

  if (hasBookingIntent(trimmed)) {
    nextState.outOfScopeStrikes = 0;
  }

  // --- Greeting ---
  if (isGreeting(trimmed)) {
    return {
      message: OPENING_MESSAGE,
      suggestions: ["Ver serviços", "Quero agendar"],
      trace: [],
      state: nextState,
      reset: false,
      appointmentCreated: false,
      uiHints: getUiHints(nextState),
    };
  }

  // --- List services ---
  if (detectIntent(trimmed) === "list_services") {
    trace.push({ type: "list_services" });
    const list = formatServicesList(catalog);
    return {
      message: `Aqui os principais:\n${list}\n\nGostaria de agendar um horário ou ver outras opções?`,
      suggestions: ["Quero agendar", "Corte", "Corte + Barba"],
      trace,
      state: nextState,
      reset: false,
      appointmentCreated: false,
      uiHints: getUiHints(nextState),
    };
  }

  // --- Book flow: slot-filling ---
  nextState.intent = "book";

  const resolvedServices = resolveServiceIds(catalog, trimmed, nextState.serviceIds);
  if (resolvedServices.length) nextState.serviceIds = resolvedServices;

  const parsedDate = parseDate(trimmed, refDate);
  if (parsedDate) nextState.date = parsedDate;

  const parsedTime = parseTime(trimmed);
  if (parsedTime) nextState.time = parsedTime;

  if (isLikelyName(trimmed) && nextState.lastBotQuestion === "name") {
    nextState.clientName = trimmed;
    tools.createAppointment(catalog, nextState);
    nextState.appointmentCreated = true;
    const serviceNames = catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).map((s) => s.name).join(" + ");
    const barber = catalog.barbers.find((b) => b.id === nextState.barberId);
    const total = catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).reduce((a, s) => a + s.price, 0);
    return {
      message: `Agendamento confirmado!\n\n*${serviceNames}*\n${nextState.date} às ${nextState.time}\n${barber?.name ?? "Barbeiro"}\n*R$ ${total.toFixed(2).replace(".", ",")}*\n\nAguardamos você!`,
      suggestions: ["Assinar agora", "Tirar dúvidas via WhatsApp"],
      trace: [],
      state: nextState,
      reset: false,
      appointmentCreated: true,
      uiHints: getUiHints(nextState),
    };
  }

  if (isAffirmative(trimmed) && nextState.lastBotQuestion === "confirm") {
    if (!nextState.clientName) {
      nextState.lastBotQuestion = "name";
      const total = catalog.services
        .filter((s) => nextState.serviceIds.includes(s.id))
        .reduce((a, s) => a + s.price, 0);
      const barber = catalog.barbers.find((b) => b.id === nextState.barberId);
      return {
        message:
          `Show! *${catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).map((s) => s.name).join(" + ")}* • ${nextState.date} ${nextState.time} • ${barber?.name ?? "barbeiro"} — *R$ ${total.toFixed(2).replace(".", ",")}*.\n\nPra salvar aqui, qual seu nome? 🙂`,
        suggestions: [],
        trace: [],
        state: nextState,
        reset: false,
        appointmentCreated: false,
        uiHints: getUiHints(nextState),
      };
    }
    tools.createAppointment(catalog, nextState);
    nextState.appointmentCreated = true;
    const serviceNames = catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).map((s) => s.name).join(" + ");
    const barber = catalog.barbers.find((b) => b.id === nextState.barberId);
    const total = catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).reduce((a, s) => a + s.price, 0);
    return {
      message: `Agendamento confirmado!\n\n*${serviceNames}*\n${nextState.date} às ${nextState.time}\n${barber?.name ?? "Barbeiro"}\n*R$ ${total.toFixed(2).replace(".", ",")}*\n\nAguardamos você!`,
      suggestions: ["Assinar agora", "Tirar dúvidas via WhatsApp"],
      trace: [],
      state: nextState,
      reset: false,
      appointmentCreated: true,
      uiHints: getUiHints(nextState),
    };
  }

  if (isNoPreference(trimmed) && nextState.date && nextState.time && nextState.serviceIds.length) {
    const result = tools.checkAvailability(catalog, {
      date: nextState.date,
      time: nextState.time,
      serviceIds: nextState.serviceIds,
      seed: sessionSeed,
    });
    if (result.requested.available && result.requested.barbers.length) {
      nextState.barberId = result.requested.barbers[0].barber_id;
      nextState.lastBotQuestion = "confirm";
      const total = result.total_price;
      const barber = result.requested.barbers[0];
      return {
        message: `Show — vou te colocar com o *${barber.barber_name}* então.\n\n*${catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).map((s) => s.name).join(" + ")}* • ${nextState.date} ${nextState.time} • *R$ ${total.toFixed(2).replace(".", ",")}*\n\nFecho assim?`,
        suggestions: ["Sim", "Confirmo"],
        trace: [],
        state: nextState,
        reset: false,
        appointmentCreated: false,
        uiHints: getUiHints(nextState),
      };
    }
  }

  if (!nextState.serviceIds.length) {
    nextState.lastBotQuestion = "service";
    trace.push({ type: "list_services" });
    const list = formatServicesList(catalog);
    return {
      message: `Pra qual serviço você quer marcar?\n\n${list}`,
      suggestions: ["Corte", "Barba", "Corte + Barba", "Sobrancelha"],
      trace,
      state: nextState,
      reset: false,
      appointmentCreated: false,
    };
  }

  if (!nextState.date || !nextState.time) {
    const today = refDate.toISOString().slice(0, 10);
    const tomorrow = new Date(refDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    if (!nextState.date) {
      nextState.lastBotQuestion = "date";
      return {
        message: "Pra quando você quer? (hoje, amanhã ou a data)",
        suggestions: ["Hoje", "Amanhã", "Sexta", "Sábado"],
        trace: [],
        state: nextState,
        reset: false,
        appointmentCreated: false,
        uiHints: getUiHints(nextState),
      };
    }

    if (!nextState.time) {
      nextState.lastBotQuestion = "time";
      trace.push({ type: "get_next_slots", date: nextState.date });
      const afterTime =
        nextState.date === today
          ? `${String(refDate.getHours()).padStart(2, "0")}:${String(refDate.getMinutes()).padStart(2, "0")}`
          : undefined;
      const slotsResult = tools.getNextSlots(catalog, {
        date: nextState.date,
        serviceIds: nextState.serviceIds,
        afterTime,
        limit: 5,
        seed: sessionSeed,
      });
      const times = slotsResult.slots.map((s) => s.time);
      const uniqueTimes = [...new Set(times)].slice(0, 4);
      if (uniqueTimes.length) {
        return {
          message: `Consigo te encaixar nesses horários: *${uniqueTimes.join("* • *")}*. Qual você prefere?`,
          suggestions: uniqueTimes,
          trace,
          state: nextState,
          reset: false,
          appointmentCreated: false,
          uiHints: getUiHints(nextState),
        };
      }
      return {
        message: "Nesse dia tá bem corrido 😅 Quer tentar outro dia ou outro horário?",
        suggestions: ["Amanhã", "Outro dia"],
        trace,
        state: nextState,
        reset: false,
        appointmentCreated: false,
        uiHints: getUiHints(nextState),
      };
    }
  }

  if (nextState.date && nextState.time && nextState.serviceIds.length && !nextState.barberId) {
    trace.push({ type: "check_availability", date: nextState.date, time: nextState.time });
    const result = tools.checkAvailability(catalog, {
      date: nextState.date,
      time: nextState.time,
      serviceIds: nextState.serviceIds,
      seed: sessionSeed,
    });

    if (result.requested.available && result.requested.barbers.length) {
      if (isNoPreference(trimmed)) {
        nextState.barberId = result.requested.barbers[0].barber_id;
      } else {
        nextState.barberId = result.requested.barbers[0].barber_id;
      }
      nextState.lastBotQuestion = "confirm";
      const barber = result.requested.barbers[0];
      const total = result.total_price;
      return {
        message: `*${catalog.services.filter((s) => nextState.serviceIds.includes(s.id)).map((s) => s.name).join(" + ")}* • ${nextState.date} ${nextState.time} • ${barber.barber_name} — *R$ ${total.toFixed(2).replace(".", ",")}*.\n\nFecho assim?`,
        suggestions: ["Sim", "Confirmo", "Qualquer um"],
        trace,
        state: nextState,
        reset: false,
        appointmentCreated: false,
        uiHints: getUiHints(nextState),
      };
    }

    if (result.alternatives.length) {
      const alt = result.alternatives.slice(0, 3).map((a) => a.time);
      return {
        message: `Esse horário não encaixou 😅 Consigo te oferecer: *${alt.join("* • *")}*. Qual prefere?`,
        suggestions: alt,
        trace,
        state: nextState,
        reset: false,
        appointmentCreated: false,
        uiHints: getUiHints(nextState),
      };
    }

    return {
      message: "Nesse horário não tenho vaga. Quer que eu sugira outros dias ou horários?",
      suggestions: ["Amanhã", "Outro horário"],
      trace,
      state: nextState,
      reset: false,
      appointmentCreated: false,
      uiHints: getUiHints(nextState),
    };
  }

  nextState.lastBotQuestion = "service";
  const list = formatServicesList(catalog);
  return {
    message: `Qual serviço você quer? 😄\n\n${list}`,
    suggestions: ["Corte", "Barba", "Corte + Barba"],
    trace: [],
    state: nextState,
    reset: false,
    appointmentCreated: false,
    uiHints: getUiHints(nextState),
  };
}
