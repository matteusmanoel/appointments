import { describe, it, expect } from "vitest";
import {
  composeHumanConsult,
  isClientConfirmation,
  isShopHoursQuestion,
  looksLikeCancelIntent,
  looksLikeConsultIntent,
  looksLikeLocationIntent,
  looksLikeRescheduleIntent,
  looksLikeTestWipeCommand,
  prefersNamedBarberOverTime,
  clientPinnedBarberClockAndDay,
  bookingDateFromUserTurn,
  assistantOfferedNextOpenDay,
  acceptsOfferedDay,
  assistantAskedReminderRsvp,
  assistantOfferedFitSlot,
  assistantOfferedSingleHour,
  assistantOfferedAltBarberSlot,
  offeredAltBarberFromText,
  acceptsOfferedFit,
  lastAssistantTurnText,
  offeredFitClockIfAccepted,
  clockForNamedBarber,
  looksLikeAfterTimeIntent,
  looksLikeNewBookingIntent,
  looksLikeNextAvailableIntent,
  looksLikeRobotQuestion,
  looksLikeZeroIntentUnknown,
  looksLikeWaitlistIntent,
  draftPatchFromTurn,
} from "../ai/conversation-intents.js";
import { applyTurnToDraft, composeHoursOverflow, composeNextAvailableOffer, composeOccupiedSlot, emptyBookingDraft, CLOSING_TODAY_THEN_TOMORROW } from "../ai/booking-draft.js";
import { composeAvailableSlotConfirm, containsAiExposure } from "../ai/agent.js";

describe("isClientConfirmation", () => {
  it("accepts polite and explicit confirms, not a new booking request", () => {
    expect(isClientConfirmation("Sim, por gentileza")).toBe(true);
    expect(isClientConfirmation("Isso mesmo")).toBe(true);
    expect(isClientConfirmation("Fica sim")).toBe(true);
    expect(isClientConfirmation("mesmo")).toBe(false);
    expect(isClientConfirmation("Por gentileza")).toBe(true);
    expect(isClientConfirmation("Por favor")).toBe(true);
    expect(isClientConfirmation("Pode confirmar")).toBe(true);
    expect(isClientConfirmation("ok")).toBe(true);
    expect(isClientConfirmation("boa, pode sim")).toBe(true);
    expect(isClientConfirmation("boa")).toBe(false);
    expect(isClientConfirmation("Quero reagendar meu corte para terça as 13h")).toBe(false);
    expect(isClientConfirmation("pode ser terça")).toBe(false);
    expect(isClientConfirmation("Pode ser as 17")).toBe(false);
    expect(isClientConfirmation("pode ser as 18:30")).toBe(false);
    expect(isClientConfirmation("Perfeito, pode agendar")).toBe(true);
    expect(isClientConfirmation("pode marcar")).toBe(true);
    expect(isClientConfirmation("Claro! Excelente")).toBe(true);
    expect(isClientConfirmation("quero agendar meu corte")).toBe(false);
    expect(isClientConfirmation("Estarei aí")).toBe(true);
    expect(isClientConfirmation("Estarei lá")).toBe(true);
    expect(isClientConfirmation("Compareço")).toBe(true);
    expect(isClientConfirmation("Vou sim")).toBe(true);
    expect(isClientConfirmation("Pode contar comigo")).toBe(true);
    expect(isClientConfirmation("Não vou até lá")).toBe(false);
    expect(isClientConfirmation("Beleza")).toBe(true);
    expect(isClientConfirmation("Beleza, vou acertar no dia 10")).toBe(false);
    expect(isClientConfirmation("Ok, te pago depois")).toBe(false);
  });

  it("resolves the same affirmative claim regardless of word order (RC3 regression)", () => {
    // "Fica sim" and "Sim, fica" are the same claim — an anchored ^(sim|...) regex only
    // caught the second form. Reproduces the barber-offer loop from the 23/09 transcript
    // where "Fica sim" alone did not register as accepting the offered barber.
    expect(isClientConfirmation("Fica sim")).toBe(true);
    expect(isClientConfirmation("Fica sim, pode ser")).toBe(true);
    expect(isClientConfirmation("Tá show, fechado")).toBe(true);
    expect(isClientConfirmation("Tá combinado então")).toBe(true);
    // Negation must still win — "sim" appearing alongside "não" in the same short reply
    // is not a clean affirmation (the unanchored fallback must not override that).
    expect(isClientConfirmation("Tudo bem, mas sim, não vou")).toBe(false);
  });
});

describe("conversation intents", () => {
  it("detects consult vs reschedule vs cancel vs location vs /deletar", () => {
    expect(looksLikeConsultIntent("Gostaria de consultar meu agendamento, pra quando ficou mesmo?")).toBe(true);
    expect(looksLikeConsultIntent("Pra quando ficou meu agendamento?")).toBe(true);
    expect(looksLikeConsultIntent("segunda que horas?")).toBe(true);
    expect(looksLikeConsultIntent("que horas ficou?")).toBe(true);
    expect(looksLikeConsultIntent("a que horas")).toBe(true);
    expect(looksLikeRescheduleIntent("Quero reagendar meu corte para terça as 13h, o Lucas teria disponibilidade?")).toBe(
      true,
    );
    expect(looksLikeRescheduleIntent("reagenda para terça as 10h")).toBe(true);
    expect(looksLikeRescheduleIntent("Quero mudar meu horário de quinta para sexta")).toBe(true);
    expect(looksLikeConsultIntent("Quero reagendar meu corte para terça as 13h")).toBe(false);
    expect(looksLikeCancelIntent("Surgiu um imprevisto, não vou poder ir")).toBe(true);
    expect(looksLikeCancelIntent("Cancela pra mim")).toBe(true);
    expect(looksLikeCancelIntent("Na verdade, não vou conseguir ir")).toBe(true);
    expect(looksLikeCancelIntent("Nao poderei ir")).toBe(true);
    expect(looksLikeCancelIntent("Remarca pra mim, segunda as 15h")).toBe(false);
    expect(looksLikeLocationIntent("Onde fica a loja?")).toBe(true);
    expect(looksLikeLocationIntent("manda o pin")).toBe(true);
    expect(looksLikeTestWipeCommand("/deletar")).toBe(true);
    expect(looksLikeTestWipeCommand("deletar")).toBe(true);
    expect(looksLikeTestWipeCommand("não deletar agora")).toBe(false);
  });

  it("treats shop hours questions as functioning, not booking date", () => {
    expect(isShopHoursQuestion("Olá tudo bem? Estão abertos hoje?")).toBe(true);
    expect(isShopHoursQuestion("que horas fecha?")).toBe(true);
    expect(isShopHoursQuestion("o Lucas tem disponibilidade as 18:30?")).toBe(false);
    expect(looksLikeConsultIntent("que horas fecha?")).toBe(false);
    expect(bookingDateFromUserTurn("Estão abertos hoje?", "2026-09-20")).toBeNull();
    expect(bookingDateFromUserTurn("quero marcar hoje às 17h", "2026-09-20")?.date).toBe("2026-09-20");
  });

  it("treats a bare 'pode ser' as zero intent and a real booking as not", () => {
    expect(looksLikeZeroIntentUnknown("pode ser")).toBe(true);
    expect(looksLikeZeroIntentUnknown("Carlos")).toBe(true);
    expect(looksLikeZeroIntentUnknown("quero corte amanhã às 10h")).toBe(false);
    expect(looksLikeZeroIntentUnknown("Olá tudo bem?")).toBe(false);
    expect(looksLikeZeroIntentUnknown("Estão abertos hoje?")).toBe(false);
    expect(looksLikeZeroIntentUnknown("qual a chave pix?")).toBe(false);
    expect(looksLikeZeroIntentUnknown("Pode ser qualquer barbeiro, tanto faz")).toBe(false);
    expect(looksLikeZeroIntentUnknown("Quero reagendar meu horário")).toBe(false);
  });

  it("detects a fresh booking and ignores corrections or reschedules", () => {
    expect(looksLikeNewBookingIntent("Quero agendar barba amanhã às 11h")).toBe(true);
    expect(looksLikeNewBookingIntent("Quero reagendar meu horário")).toBe(false);
    expect(looksLikeNewBookingIntent("Preciso cancelar meu agendamento")).toBe(false);
    expect(looksLikeNewBookingIntent("Na verdade eu pedi corte e barba, não só barba. Pode alterar?")).toBe(false);
    expect(looksLikeNewBookingIntent("pode ser")).toBe(false);
    expect(looksLikeNewBookingIntent("Carlos")).toBe(false);
  });

  it("writes tomorrow when the client accepts an offered next-open day", () => {
    expect(assistantOfferedNextOpenDay("Posso te encaixar amanhã. Fica bom pra você?")).toBe(true);
    expect(acceptsOfferedDay("pode ser")).toBe(true);
    expect(bookingDateFromUserTurn("pode ser", "2026-09-20")).toBeNull();
  });

  it("binds last_fit clock when the client accepts the overflow invite", () => {
    const invite = composeHoursOverflow({
      lastFitTime: "18:00",
      lastFitBarberName: "Lucas Lima",
      isToday: true,
    });
    expect(assistantOfferedFitSlot(invite)).toBe(true);
    expect(acceptsOfferedFit("Claro! Excelente")).toBe(true);
    expect(
      offeredFitClockIfAccepted({ lastAssistant: invite, lastUser: "Claro! Excelente" }),
    ).toBe("18:00");
    expect(offeredFitClockIfAccepted({ lastAssistant: invite, lastUser: "e às 17:30?" })).toBeNull();
    expect(invite).toMatch(/18h/);
    expect(invite).not.toMatch(/18h30/);
  });

  it("same accept after split bubbles still binds the offered clock, with different wording", () => {
    const turn = lastAssistantTurnText([
      { role: "assistant", content: "Posso te encaixar hoje às 17h30 com o Eduardo" },
      { role: "assistant", content: "Fica bom pra você?" },
      { role: "user", content: "Show, fica ótimo" },
    ]);
    expect(assistantOfferedFitSlot(turn)).toBe(true);
    expect(acceptsOfferedFit("Show, fica ótimo")).toBe(true);
    expect(offeredFitClockIfAccepted({ lastAssistant: turn, lastUser: "Show, fica ótimo" })).toBe("17:30");
    expect(
      offeredFitClockIfAccepted({
        lastAssistant: "Tenho às 17h30 ou às 17h. Qual prefere?",
        lastUser: "Claro! Excelente",
      }),
    ).toBeNull();
  });

  it("detects explicit barber-over-time preference", () => {
    expect(prefersNamedBarberOverTime("seria só com o Lucas mesmo")).toBe(true);
    expect(prefersNamedBarberOverTime("pode ser com o Eduardo")).toBe(false);
    const barbers = [{ id: "b1", name: "Lucas Lima" }];
    expect(clientPinnedBarberClockAndDay("só com o Lucas amanhã às 10h", barbers, "2026-09-24")).toBe(true);
    expect(clientPinnedBarberClockAndDay("corte e barba", barbers, "2026-09-24")).toBe(false);
  });

  it("treats reminder copy as RSVP and PIX copy as not", () => {
    expect(assistantAskedReminderRsvp("Eduardo, ainda não tivemos sua confirmação do horário às 17:00. Confirma, cancela ou remarca por aqui")).toBe(
      true,
    );
    expect(assistantAskedReminderRsvp("só lembrando do seu horário com o Lucas daqui 2h. Aguardamos você")).toBe(true);
    expect(assistantAskedReminderRsvp("Chave PIX da Navalhia: abc")).toBe(false);
    expect(assistantAskedReminderRsvp("Fica assim, então:\nPosso confirmar?")).toBe(false);
  });

  it("recognizes the real production reminder templates (RC6 regression)", () => {
    // buildReminder24h pending — outbound/templates.ts. The old pattern list never
    // matched this actual copy, so a live "Estarei aí" reply to the 24h reminder never
    // resolved as an RSVP and fell through to unrelated deterministic branches.
    expect(
      assistantAskedReminderRsvp(
        "Fala, Mateus! Passando para confirmar seu agendamento:\n\n✂️ *Corte e Barba*\n💈 *Eduardo Gustavo*\n📅 Amanhã, quinta, 24/09 às 18h\n💰 R$ 55,00\n\nSeu horário está reservado. *Você confirma sua presença ou prefere reagendar?*",
      ),
    ).toBe(true);
    // buildReminder2hPending
    expect(
      assistantAskedReminderRsvp(
        "Mateus, ainda não recebemos sua confirmação.\n\n*Você vem hoje às 18h?* Confirme agora para mantermos seu horário reservado. Caso não haja confirmação, precisaremos liberá-lo.",
      ),
    ).toBe(true);
    expect(
      assistantAskedReminderRsvp(
        "Olá, Mateus! Tudo certo com seu horário para Corte e Barba amanhã às 18h com o Eduardo Gustavo? Se quiser cancelar ou reagendar é só me dizer o novo dia e horário.",
      ),
    ).toBe(false);
    expect(assistantAskedReminderRsvp("Chave PIX da Navalhia: abc")).toBe(false);
  });
});

describe("human copy", () => {
  it("consult sounds like a check-in, not a system error", () => {
    const out = composeHumanConsult({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      weekdayShort: "segunda",
      barberName: "Lucas",
      timeHHmm: "18:00",
    });
    expect(out).toMatch(/Olá, Mateus!/);
    expect(out).toMatch(/Corte e Barba na segunda com o Lucas às 18h/);
    expect(out).toMatch(/cancelar ou reagendar/);
    expect(containsAiExposure(out)).toBe(false);
    expect(out).not.toMatch(/não consegui validar/i);
    expect(out).not.toMatch(/atendente/i);
  });

  it("summary uses a light emoji layout and still asks to confirm", () => {
    const out = composeAvailableSlotConfirm({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      barberName: "Lucas Lima",
      dateIso: "2026-09-22",
      timeHHmm: "13:00",
      totalPrice: 55,
    });
    expect(out).toMatch(/Posso confirmar\?/);
    expect(out).toMatch(/✂️/);
    expect(out).toMatch(/Terça, 22\/09 às 13h/);
    expect(containsAiExposure(out)).toBe(false);
  });

  it("consult still includes the clock time with a different weekday", () => {
    const out = composeHumanConsult({
      serviceName: "Barba completa",
      weekdayShort: "terça",
      barberName: "Eduardo",
      timeHHmm: "10:30",
    });
    expect(out).toMatch(/terça com o Eduardo às 10h30/);
    expect(out).toMatch(/Eduardo/);
  });
});

const LUCAS_BARBER = { id: "a9354524-6859-40fb-9b52-f3b2ef322b35", name: "Lucas Lima" };
const EDUARDO_BARBER = { id: "df811fd9-91e3-4060-8cf0-ad3cd4dfff5c", name: "Eduardo Gustavo" };
const BARBERS_CATALOG = [EDUARDO_BARBER, LUCAS_BARBER];

describe("assistantOfferedAltBarberSlot / offeredAltBarberFromText (BUG-2 regression)", () => {
  const altBarberOffer = composeOccupiedSlot({
    barberName: "Lucas Lima",
    timeHHmm: "18:30",
    alternatives: [],
    sameTimeOthers: [{ barber_name: "Eduardo Gustavo" }],
  });

  it("assistantOfferedFitSlot returns false for alt-barber offer to avoid loop", () => {
    // The fix: "ou seria só com" guard prevents treating this as a regular fit-slot
    expect(assistantOfferedFitSlot(altBarberOffer)).toBe(false);
  });

  it("assistantOfferedAltBarberSlot detects the alt-barber offer correctly", () => {
    expect(assistantOfferedAltBarberSlot(altBarberOffer)).toBe(true);
  });

  it("offeredAltBarberFromText resolves Eduardo from the offer text", () => {
    const resolved = offeredAltBarberFromText(altBarberOffer, BARBERS_CATALOG);
    expect(resolved?.id).toBe(EDUARDO_BARBER.id);
    expect(resolved?.name).toMatch(/Eduardo/);
  });

  it("regular fit-slot is still detected correctly (no regression)", () => {
    const fitSlot = "Posso te encaixar hoje às 18h com o Lucas[[MSG]]Fica bom pra você?";
    expect(assistantOfferedFitSlot(fitSlot)).toBe(true);
    expect(assistantOfferedAltBarberSlot(fitSlot)).toBe(false);
  });

  it("semantic variant: different barber name still resolves (Camila / Marcos)", () => {
    const camila = { id: "c1", name: "Camila Ferreira" };
    const marcos = { id: "m1", name: "Marcos Rodrigues" };
    const offer = composeOccupiedSlot({
      barberName: "Marcos Rodrigues",
      timeHHmm: "14:30",
      alternatives: [],
      sameTimeOthers: [{ barber_name: "Camila Ferreira" }],
    });
    expect(assistantOfferedFitSlot(offer)).toBe(false);
    expect(assistantOfferedAltBarberSlot(offer)).toBe(true);
    const resolved = offeredAltBarberFromText(offer, [camila, marcos]);
    expect(resolved?.id).toBe(camila.id);
  });
});

describe("looksLikeAfterTimeIntent (Round 4 regression)", () => {
  it("detects 'após as X' as an open-ended time intent", () => {
    expect(looksLikeAfterTimeIntent("após as 18h")).toBe(true);
    expect(looksLikeAfterTimeIntent("depois das 17h")).toBe(true);
    expect(looksLikeAfterTimeIntent("a partir das 16h")).toBe(true);
    expect(looksLikeAfterTimeIntent("tem algum horário às 18h ou depois?")).toBe(true);
  });

  it("does NOT flag exact time requests as after-time intent", () => {
    expect(looksLikeAfterTimeIntent("quero às 18h")).toBe(false);
    expect(looksLikeAfterTimeIntent("pode ser às 17:30?")).toBe(false);
    expect(looksLikeAfterTimeIntent("às 14h30")).toBe(false);
  });

  it("treats a split 'às 18' + 'Ou após' bubble as a floor", () => {
    expect(looksLikeAfterTimeIntent("O lucas pode me atender hoje as 18?\nOu após")).toBe(true);
    expect(looksLikeAfterTimeIntent("quero às 18h")).toBe(false);
  });
});

describe("looksLikeWaitlistIntent (RC3 regression — semantic phrasing, not just fixed phrases)", () => {
  it("still detects the original literal phrases", () => {
    expect(looksLikeWaitlistIntent("Quero entrar na lista de espera")).toBe(true);
    expect(looksLikeWaitlistIntent("Não tem nenhum horário?")).toBe(true);
  });

  it("detects a natural notify-me-when-it-frees-up request naming a specific barber", () => {
    // From the 23/09 transcript: the client's clearest waitlist request of the whole
    // conversation went unrecognized because it didn't use any of the 3 literal phrases.
    expect(looksLikeWaitlistIntent("Se o Lucas liberar me avise")).toBe(true);
    expect(looksLikeWaitlistIntent("Me avisa quando abrir um horário com ele")).toBe(true);
  });

  it("does not flag unrelated messages", () => {
    expect(looksLikeWaitlistIntent("Quero corte e barba amanhã às 18h")).toBe(false);
  });
});

describe("draftPatchFromTurn", () => {
  const services = [
    { id: "d4ad6587-1437-4853-b6f0-8d059485b99d", name: "Corte masculino", price: 35 },
    { id: "522142c0-7621-4f88-825b-ad5f0c82c6a5", name: "Corte e Barba", category: "combo", price: 55 },
  ];
  const barbers = [
    { id: "df811fd9-91e3-4060-8cf0-ad3cd4dfff5c", name: "Eduardo Gustavo" },
    { id: "a9354524-6859-40fb-9b52-f3b2ef322b35", name: "Lucas Lima" },
  ];
  const today = "2026-09-21";

  it("keeps the floor when the service is still unknown", () => {
    const asked = draftPatchFromTurn({
      text: "O lucas pode me atender hoje as 18?\nOu após",
      todayIso: today,
      services,
      barbers,
    });
    expect(asked.afterIntent).toBe(true);
    expect(asked.patch.after_time).toBe("18:00");
    expect(asked.patch.time).toBeUndefined();
    expect(asked.patch.date).toBe("2026-09-21");
    expect(asked.patch.barber_id).toBe(barbers[1]!.id);
    expect(asked.patch.service_ids).toBeUndefined();
    const draft = applyTurnToDraft(emptyBookingDraft(), asked.patch);
    const corte = draftPatchFromTurn({
      text: "Preciso cortar meu cabelo",
      todayIso: today,
      services,
      barbers,
    });
    const still = applyTurnToDraft(draft, corte.patch);
    expect(still.after_time).toBe("18:00");
    expect(still.date).toBe("2026-09-21");
    expect(still.barber_id).toBe(barbers[1]!.id);
    expect(still.time).toBeUndefined();
  });

  it("stores amanhã without turning a previous floor into an exact clock", () => {
    const opened = applyTurnToDraft(
      emptyBookingDraft(),
      draftPatchFromTurn({
        text: "hoje as 18 ou após",
        todayIso: today,
        services,
        barbers,
      }).patch,
    );
    const tomorrow = draftPatchFromTurn({
      text: "Seria só com o Lucas mesmo, tem amanhã?",
      todayIso: today,
      services,
      barbers,
    });
    expect(tomorrow.patch.date).toBe("2026-09-22");
    expect(tomorrow.patch.time).toBeUndefined();
    expect(tomorrow.patch.after_time).toBeUndefined();
    const draft = applyTurnToDraft(opened, tomorrow.patch);
    expect(draft.date).toBe("2026-09-22");
    expect(draft.after_time).toBe("18:00");
    expect(draft.time).toBeUndefined();
  });

  it("does not store 'após as 18' as an exact time", () => {
    const turn = draftPatchFromTurn({
      text: "Teria apos as 18?",
      todayIso: today,
      services,
      barbers,
    });
    expect(turn.afterIntent).toBe(true);
    expect(turn.patch.after_time).toBe("18:00");
    expect(turn.patch.time).toBeUndefined();
  });
});

describe("a new hour beats the previous offer", () => {
  it("does not keep 17h when this message says 18h", () => {
    const offer = "Posso te encaixar nesse dia às 17h com o Lucas. Fica bom pra você?";
    expect(assistantOfferedFitSlot(offer)).toBe(true);
    expect(isClientConfirmation("Por favor")).toBe(true);
    expect(
      offeredFitClockIfAccepted({
        lastAssistant: offer,
        lastUser: "Me refiro às 18h",
      }),
    ).toBeNull();
  });

  it("keeps the hour the client asked when they name another barber", () => {
    expect(clockForNamedBarber("Corte e barba amanhã às 17h com o Lucas", "17:30")).toBe("17:00");
    expect(clockForNamedBarber("Fica sim", "17:30")).toBe("17:30");
  });

  it("a short yes after quer esse binds that same hour", () => {
    const offer = "Nesse horário o Lucas está atendendo. 16h com ele está livre. Quer esse?";
    expect(assistantOfferedSingleHour(offer)).toBe(true);
    expect(
      offeredFitClockIfAccepted({
        lastAssistant: offer,
        lastUser: "Pode",
      }),
    ).toBe("16:00");
  });

  it("a short yes after fica bom binds the offered hour", () => {
    expect(
      offeredFitClockIfAccepted({
        lastAssistant: "Posso te encaixar às 17h com o Lucas. Fica bom?",
        lastUser: "Por favor",
      }),
    ).toBe("17:00");
  });
});


describe("looksLikeNextAvailableIntent", () => {
  it("recognizes 'o próximo' and close variants, not a named clock or a consult", () => {
    expect(looksLikeNextAvailableIntent("Pode ser o próximo")).toBe(true);
    expect(looksLikeNextAvailableIntent("o próximo horário")).toBe(true);
    expect(looksLikeNextAvailableIntent("o mais cedo")).toBe(true);
    expect(looksLikeNextAvailableIntent("qualquer horário")).toBe(true);
    expect(looksLikeNextAvailableIntent("o primeiro que tiver")).toBe(true);
    expect(looksLikeNextAvailableIntent("o primeiro horário")).toBe(true);
    expect(looksLikeNextAvailableIntent("pode ser agora")).toBe(true);
    expect(looksLikeNextAvailableIntent("pode ser às 18h")).toBe(false);
    expect(looksLikeNextAvailableIntent("quais são meus próximos horários")).toBe(false);
    expect(looksLikeNextAvailableIntent("quero cancelar")).toBe(false);
    expect(looksLikeNextAvailableIntent("quero cancelar o próximo")).toBe(false);
    expect(looksLikeNextAvailableIntent("quero reagendar, pode ser o próximo")).toBe(true);
    expect(isClientConfirmation("Pode ser o próximo")).toBe(false);
    expect(looksLikeZeroIntentUnknown("Pode ser o próximo")).toBe(false);
    expect(looksLikeZeroIntentUnknown("pode ser")).toBe(true);
  });
});

describe("composeNextAvailableOffer", () => {
  it("lists 2–3 concrete hours and uses the agreed closing copy when today has no slot", () => {
    expect(
      composeNextAvailableOffer({
        timesHHmm: ["18:30", "19:00"],
        dateIso: "2026-11-14",
        todayIso: "2026-11-14",
      }),
    ).toBe("Consigo te atender hoje às 18h30 ou às 19h. Qual prefere?");
    const rolled = composeNextAvailableOffer({
      timesHHmm: ["09:00", "09:30", "10:00"],
      dateIso: "2026-11-15",
      todayIso: "2026-11-14",
      rolledFromToday: true,
    });
    expect(rolled.startsWith(CLOSING_TODAY_THEN_TOMORROW)).toBe(true);
    expect(rolled).toContain("às 9h, às 9h30 ou às 10h");
    expect(rolled).not.toMatch(/Qual hora você prefere/);
    expect(rolled).not.toMatch(/segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo/i);
    const monday = composeNextAvailableOffer({
      timesHHmm: ["09:00", "09:30"],
      dateIso: "2026-11-16",
      todayIso: "2026-11-14",
      rolledFromToday: true,
    });
    expect(monday.startsWith(CLOSING_TODAY_THEN_TOMORROW)).toBe(true);
    expect(monday).toContain("amanhã");
    expect(monday).not.toMatch(/segunda/i);
  });
});

describe("looksLikeRobotQuestion", () => {
  it("reconhece «você é um robô?» e não trata como pedido de atendente", () => {
    expect(looksLikeRobotQuestion("você é um robô?")).toBe(true);
    expect(looksLikeRobotQuestion("vc é um bot?")).toBe(true);
    expect(looksLikeRobotQuestion("quero agendar um corte")).toBe(false);
  });
});
