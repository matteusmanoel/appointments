/**
 * Transforma o fato decidido pela máquina em resposta. O template garante os fatos; o LLM só varia a
 * redação e a resposta volta ao template se citar horário, data, preço, serviço ou barbeiro diferente.
 */
import type OpenAI from "openai";
import {
  composeAvailableSlotConfirm,
  composeBookingCreated,
  composeCancellationReply,
  composePresenceConfirmed,
  composeRescheduleAsk,
  composeRescheduleDone,
  containsAiExposure,
  minutesUntilAppointment,
  REMINDER_BUBBLE_LEAD_MINUTES,
  scrubAiExposure,
} from "../../agent.js";
import {
  composeAmbiguousCorte,
  composeNextAvailableOffer,
  composeSuggestUsualService,
} from "../../booking-draft.js";
import { formatResumoWhen } from "../../date-calendar.js";
import { DEFAULT_CHAT_MODEL, createChatCompletion } from "../../models.js";
import {
  CANCEL_NONE_SAFE,
  composeCancelConfirmAsk,
  composeWhichAppointmentAsk,
  RESCHEDULE_NONE_SAFE,
} from "../confirmation-card.js";
import { templateFactsPreserved } from "../language-rewrite.js";
import { ASK_BOOKING_NAME, ASK_SERVICE } from "../orchestrator.js";
import type { SocialKind } from "../turn-interpreter.js";
import type { UpcomingFact, V2Context, V2Say } from "./machine.js";

export const HANDOFF_REPLY = "Um atendente vai te atender em instantes. Aguarde um momento.";

/** Confirmações de escrita e avisos com texto obrigatório não passam pelo modelo. */
const FIXED_KINDS = new Set<V2Say["kind"]>([
  "booked",
  "moved",
  "cancelled",
  "presence_confirmed",
  "handoff",
  "side_only",
  "delegate_legacy",
]);

export type ComposeData = {
  say: V2Say;
  context: V2Context;
  upcoming: UpcomingFact[];
  firstName?: string;
  todayIso: string;
  nowHHmm: string;
  social: SocialKind;
  services: string[];
  barbersByName: string[];
};

function appointment(data: ComposeData, id: string): UpcomingFact | undefined {
  return data.upcoming.find((item) => item.id === id);
}

function firstWord(name: string | null | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

export function templateFor(data: ComposeData): string {
  const { say, context, todayIso } = data;
  const when = context.date && context.time ? formatResumoWhen(context.date, context.time, todayIso) : "";
  switch (say.kind) {
    case "clarify":
      if (data.social === "greeting") return "Olá! Quer ver os serviços ou já prefere marcar um horário?";
      if (data.social === "thanks") return "Por nada! Qualquer coisa é só chamar.";
      if (data.social === "bye") return "Até mais!";
      return "Me diz se você quer agendar, remarcar ou cancelar.";
    case "ask_service":
      return ASK_SERVICE;
    case "ask_usual_service":
      return composeSuggestUsualService({ usualName: say.service_name, barberName: context.barber_name });
    case "ask_simple_or_combo": {
      const simple = data.services.find((name) => /corte/i.test(name) && !/barba|combo/i.test(name));
      const combo = data.services.find((name) => /corte/i.test(name) && /barba|combo/i.test(name));
      return simple && combo ? composeAmbiguousCorte({ simpleName: simple, comboName: combo }) : ASK_SERVICE;
    }
    case "ask_datetime":
      return "Qual dia e horário ficam bons pra você?";
    case "ask_name":
      return ASK_BOOKING_NAME;
    case "offer_slot":
      return composeAvailableSlotConfirm({
        serviceName: context.service_name ?? "Horário",
        barberName: context.barber_name ?? "o barbeiro",
        dateIso: context.date ?? todayIso,
        timeHHmm: context.time ?? "00:00",
        totalPrice: context.price ?? 0,
        firstName: data.firstName,
        todayIso,
      });
    case "offer_move": {
      const current = appointment(data, say.appointment_id);
      return composeRescheduleAsk({
        firstName: data.firstName,
        serviceName: current?.service_names ?? context.service_name ?? "seu horário",
        when: current ? formatResumoWhen(current.date, current.time, todayIso) : "",
        barberName: current?.barber_name,
        nextWhen: when,
      });
    }
    case "slot_busy":
      return `Esse horário não está livre. ${composeNextAvailableOffer({
        timesHHmm: say.times,
        dateIso: context.date ?? todayIso,
        todayIso,
      })}`;
    case "slots_listed":
      return composeNextAvailableOffer({ timesHHmm: say.times, dateIso: say.date, todayIso });
    case "no_slots":
      return "Não encontrei vaga nesse período. Qual outro dia fica bom pra você?";
    case "offer_expired":
      return "Essa oferta expirou. Se ainda quiser, me diz o dia e o horário que eu confiro de novo.";
    case "offer_declined":
      return "Sem problema. Qual outro dia ou horário fica melhor?";
    case "booked": {
      const minutes = context.date && context.time
        ? minutesUntilAppointment({ dateIso: context.date, timeHHmm: context.time, todayIso, nowHHmm: data.nowHHmm })
        : null;
      return composeBookingCreated({
        firstName: data.firstName ?? "tudo certo",
        serviceName: context.service_name ?? "Horário",
        when,
        barberName: context.barber_name ?? undefined,
        remindBefore: minutes != null && minutes >= REMINDER_BUBBLE_LEAD_MINUTES,
      });
    }
    case "moved":
      return composeRescheduleDone({
        firstName: data.firstName ?? "tudo certo",
        serviceName: context.service_name ?? "Horário",
        when,
        barberName: context.barber_name ?? undefined,
      });
    case "write_failed":
      return "Esse horário acabou de ser ocupado e não consegui gravar. Qual outro horário fica bom?";
    case "cancel_ask": {
      const current = appointment(data, say.appointment_id);
      return composeCancelConfirmAsk({
        serviceName: current?.service_names,
        when: current ? formatResumoWhen(current.date, current.time, todayIso) : "",
        barberName: firstWord(current?.barber_name),
      });
    }
    case "cancel_kept":
      return "Combinado, seu horário continua marcado.";
    case "cancelled": {
      const current = appointment(data, say.appointment_id);
      return composeCancellationReply({
        serviceName: current?.service_names,
        when: current ? formatResumoWhen(current.date, current.time, todayIso) : "",
        barberName: firstWord(current?.barber_name),
      });
    }
    case "which_appointment":
      return composeWhichAppointmentAsk(
        data.upcoming.map((item) => ({ serviceName: item.service_names, date: item.date, time: item.time })),
        todayIso,
        say.verb,
      );
    case "no_appointment":
      return say.verb === "cancelar" ? CANCEL_NONE_SAFE : RESCHEDULE_NONE_SAFE;
    case "presence_confirmed": {
      const current = appointment(data, say.appointment_id);
      return composePresenceConfirmed({
        firstName: data.firstName,
        when: current ? formatResumoWhen(current.date, current.time, todayIso) : "",
        barberName: firstWord(current?.barber_name),
      });
    }
    case "waitlist_added":
      return "Anotei! Se esse horário abrir, eu te aviso por aqui.";
    case "waitlist_missing": {
      const labels = { date: "o dia", time: "o horário", service: "o serviço" };
      return `Para te colocar na fila, me diz ${say.missing.map((item) => labels[item]).join(", ")}.`;
    }
    case "handoff":
      return HANDOFF_REPLY;
    case "side_only":
    case "delegate_legacy":
      return "";
  }
}

export function canPolish(kind: V2Say["kind"]): boolean {
  return !FIXED_KINDS.has(kind);
}

const POLISH_PROMPT = `Reescreva a mensagem de um atendente de barbearia no WhatsApp para soar natural, em português do Brasil.
Mantenha exatamente os mesmos fatos: serviço, barbeiro, dia, hora, valor e a pergunta final. Não acrescente informação, promessa ou oferta.
Não repita a redação das mensagens anteriores. Use *negrito* só onde já existir. Mantenha o separador [[MSG]] quando houver. Não diga que é IA ou sistema.
Responda só com a mensagem reescrita.`;

export async function polishReply(
  openai: OpenAI,
  template: string,
  params: { tone: string; recentReplies: string[]; services: string[]; barbers: string[]; timeoutMs?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 4000);
  try {
    const completion = await createChatCompletion(
      openai,
      {
        model: DEFAULT_CHAT_MODEL,
        temperature: 0.7,
        max_completion_tokens: 300,
        messages: [
          { role: "system", content: `${POLISH_PROMPT}\n\nTom da barbearia: ${params.tone}` },
          {
            role: "user",
            content: `Mensagens anteriores:\n${params.recentReplies.slice(-3).join("\n---\n") || "(nenhuma)"}\n\nMensagem a reescrever:\n${template}`,
          },
        ],
      },
      { signal: controller.signal },
    );
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const text = scrubAiExposure(raw).reply.trim();
    if (!text || containsAiExposure(text)) return template;
    if (template.includes("?") && !text.includes("?")) return template;
    return templateFactsPreserved(template, text, params.services, params.barbers) ? text : template;
  } catch {
    return template;
  } finally {
    clearTimeout(timer);
  }
}
