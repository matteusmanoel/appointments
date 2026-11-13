import { describe, it, expect } from "vitest";
import { detectViolations, sanitizeClientFacingReply, composeAvailableSlotConfirm, composeUnwrittenSlotCard, looksLikeBookingConfirmationAsk, containsAiExposure, assistantMessageAskedForName, isUsableClientName, withBarberSubstitutionDisclosure, allowedConfirmAppointmentIds, guardClientReply, resolveServiceForTurn, composePresenceConfirmed, resolveToolClientPhone, confirmedPersonName, bookingDraftBlocksPresence, replyDeniesUpcoming, replyWithoutPixEcho, replyAfterPixCard, composeUpcomingRecap, looksLikeHallucinatedBookingClaim, composeBookingCreated, composeRemarcarFromLast, replyNegotiatesUnverifiedSlots, composeShopPixReply, formatMarkedWhen, minutesUntilAppointment, REMINDER_BUBBLE_LEAD_MINUTES, composeRescheduleDone, rescheduleDraftMatchesOffer, replyNarratesBookingFailure, replyClaimsPresenceConfirmed, barberIdForAvailability, pendingMoveSlot, affirmedUnverifiedClock, replyClaimsOtherClock, replyClaimsSlotIsFree, composeLocationSent, composeCancellationReply } from "../ai/agent.js";
import { splitOutgoingBubbles } from "../ai/date-calendar.js";
import { understandTurn } from "../ai/agent/understanding.js";

describe("detectViolations", () => {
  it("returns empty when reply is clean", () => {
    expect(detectViolations("Tudo certo! Qual horário você prefere?")).toEqual([]);
  });

  it("detects phone_ask when asking for phone", () => {
    const r = detectViolations("Me passa seu telefone para confirmar.");
    expect(r).toContain("phone_ask");
  });

  it("detects uuid_leak when UUID appears", () => {
    const r = detectViolations("O barbeiro 550e8400-e29b-41d4-a716-446655440000 está disponível.");
    expect(r).toContain("uuid_leak");
  });

  it("detects excessive_emojis when more than 4", () => {
    const r = detectViolations("Oi! 😀 😃 😄 😁 😂 🤣");
    expect(r).toContain("excessive_emojis");
  });

  it("detects machine failure and prompt echo as ai_exposure", () => {
    expect(detectViolations("Não consigo verificar a agenda agora.")).toContain("ai_exposure");
    expect(detectViolations("Não consigo colocar você na fila.")).toContain("ai_exposure");
    expect(detectViolations("Estou tendo dificuldades para seguir.")).toContain("ai_exposure");
    expect(detectViolations("retorne string vazia")).toContain("ai_exposure");
    expect(detectViolations("Status agora: estamos abertos hoje, até às 19:00.")).toContain("ai_exposure");
  });

  it("detects operational failure phrasing as ai_exposure", () => {
    const r = detectViolations(
      "A barbearia não abre no domingo, 20/09/2026, e também não conseguimos agendar o corte e barba com o Lucas na próxima segunda-feira.",
    );
    expect(r).toContain("ai_exposure");
  });

  it("can return multiple violations", () => {
    const r = detectViolations(
      "Me manda seu telefone e o ID 550e8400-e29b-41d4-a716-446655440000"
    );
    expect(r).toContain("phone_ask");
    expect(r).toContain("uuid_leak");
    expect(r.length).toBeGreaterThanOrEqual(2);
  });
});

describe("sanitizeClientFacingReply", () => {
  it("removes internal placeholder about ferramenta", () => {
    const raw =
      "*Total:* R$ [valor a ser informado na ferramenta]\nAguardamos você!";
    const out = sanitizeClientFacingReply(raw);
    expect(out).not.toMatch(/ferramenta/i);
    expect(out).not.toMatch(/\[valor/);
  });

  it("strips UUIDs like stripIdsAndUuids", () => {
    const out = sanitizeClientFacingReply("Seu id 550e8400-e29b-41d4-a716-446655440000 ok");
    expect(out).not.toContain("550e8400");
  });

  it("rewrites the em dash as a comma", () => {
    const out = sanitizeClientFacingReply("Posso não ter entendido — quer agendar?");
    expect(out).not.toContain("—");
    expect(out).toMatch(/entendido, quer agendar/);
  });

  it("strips ISO dates and maps URLs from client-facing copy", () => {
    const out = sanitizeClientFacingReply(
      "Fica na 2026-09-22 às 17h https://maps.google.com/maps?q=-24,-54 pin",
    );
    expect(out).not.toMatch(/2026-09-22/);
    expect(out).not.toMatch(/maps\.google/);
  });
});

describe("failed write still speaks", () => {
  it("returns the card of the slot that was not written", () => {
    const out = composeUnwrittenSlotCard({
      serviceName: "Corte e Barba",
      barberName: "Lucas Lima",
      dateIso: "2026-10-03",
      timeHHmm: "17:00",
      totalPrice: 55,
    });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toMatch(/Posso confirmar\?/);
    expect(out).toMatch(/17h/);
    expect(out).toMatch(/Lucas/);
    expect(out).not.toMatch(/✅/);
  });
});

describe("available slot confirmation copy", () => {
  it("sends a summary and asks to confirm, never failure phrasing", () => {
    const out = composeAvailableSlotConfirm({
      serviceName: "Corte e Barba",
      barberName: "Lucas Lima",
      dateIso: "2026-09-21",
      timeHHmm: "10:00",
      totalPrice: 55,
    });
    expect(out).toMatch(/Posso confirmar\?/);
    expect(out).toMatch(/Corte e Barba/);
    expect(out).toMatch(/Lucas/);
    expect(out).toMatch(/10h/);
    expect(out).toMatch(/segunda/i);
    expect(containsAiExposure(out)).toBe(false);
    expect(looksLikeBookingConfirmationAsk(out)).toBe(true);
  });

  it("12:53 close uses Amanhã + weekday + dd/MM for Monday combo 17h", () => {
    const out = composeAvailableSlotConfirm({
      firstName: "Eduardo",
      serviceName: "Corte e Barba",
      barberName: "Eduardo Gustavo",
      dateIso: "2026-09-21",
      timeHHmm: "17:00",
      totalPrice: 55,
      todayIso: "2026-09-20",
    });
    expect(out).toMatch(/Amanhã, segunda 21\/09 às 17h/);
    expect(out).toMatch(/\[\[MSG\]\]Posso confirmar\?/);
    expect(out).not.toMatch(/de setembro de 2026/);
    expect(containsAiExposure(out)).toBe(false);
  });

  it("treats a similar objective booking as needing the same confirm ask", () => {
    expect(looksLikeBookingConfirmationAsk("Corte com Eduardo terça 14h. Posso confirmar?")).toBe(true);
    expect(looksLikeBookingConfirmationAsk("Não conseguimos agendar isso.")).toBe(false);
  });

  it("detects Qual é o seu nome as a name ask", () => {
    expect(assistantMessageAskedForName("Para fechar o agendamento: qual é o seu nome?")).toBe(
      true,
    );
    expect(assistantMessageAskedForName("Pra salvar aqui, qual seu nome?")).toBe(true);
    expect(assistantMessageAskedForName("Posso confirmar?")).toBe(false);
  });
});

describe("operational failure copy", () => {
  it("treats the old atendente-confere message as exposure (must stay silent)", () => {
    expect(
      containsAiExposure(
        "Não consegui validar essa confirmação aqui no sistema. Um atendente confere pra você em instantes, combinado?",
      ),
    ).toBe(true);
    expect(containsAiExposure("Parece que não há agendamentos ativos no seu nome.")).toBe(true);
  });
});

describe("withBarberSubstitutionDisclosure", () => {
  const barbers = [{ id: "1", name: "Eduardo Gustavo" }, { id: "2", name: "Lucas Lima" }];

  it("prepends a disclosure bubble when the client named an unavailable/unknown barber (book-04 regression)", () => {
    const out = withBarberSubstitutionDisclosure(
      "Fica assim, então:\n\n✂️ *Corte masculino*[[MSG]]Posso confirmar?",
      "Corte de cabelo 2026-09-25 às 14:30 com o João",
      barbers,
      "Eduardo Gustavo",
    );
    expect(out).toMatch(/Não temos o João na equipe/);
    expect(out).toMatch(/Eduardo Gustavo tem esse horário livre/);
    expect(out).toMatch(/\[\[MSG\]\]/);
    expect(out).toMatch(/Posso confirmar\?$/);
  });

  it("does not alter the reply when the client did not name a specific barber", () => {
    const reply = "Fica assim, então:\n\n✂️ *Corte masculino*[[MSG]]Posso confirmar?";
    expect(withBarberSubstitutionDisclosure(reply, "Quero corte às 14h", barbers, "Eduardo Gustavo")).toBe(reply);
  });

  it("does not alter the reply when the named barber is the one actually offered", () => {
    const reply = "Fica assim, então:\n\n✂️ *Corte masculino*[[MSG]]Posso confirmar?";
    expect(
      withBarberSubstitutionDisclosure(reply, "Quero corte com o Eduardo às 14h", barbers, "Eduardo Gustavo"),
    ).toBe(reply);
  });
});

describe("isUsableClientName", () => {
  it("rejects the default 'cliente' placeholder", () => {
    expect(isUsableClientName("cliente")).toBe(false);
    expect(isUsableClientName("Por gentileza")).toBe(false);
    expect(isUsableClientName("Por favor")).toBe(false);
    expect(isUsableClientName("Cliente")).toBe(false);
  });

  it("rejects a stale 'Com Qualquer Barbeiro' name stored from a mis-captured barber preference", () => {
    // Regression: a stale stored client name must not be used as a booking name
    // fallback just because it's non-empty — it must still look like a real name.
    expect(isUsableClientName("Com Qualquer Barbeiro")).toBe(false);
    expect(isUsableClientName("Qualquer Um")).toBe(false);
    expect(isUsableClientName("Tanto Faz")).toBe(false);
  });

  it("accepts a plausible real name", () => {
    expect(isUsableClientName("Rafael")).toBe(true);
    expect(isUsableClientName("Ana Paula")).toBe(true);
  });

  it("rejects empty/too-short names", () => {
    expect(isUsableClientName("")).toBe(false);
    expect(isUsableClientName("A")).toBe(false);
    expect(isUsableClientName(undefined)).toBe(false);
    expect(isUsableClientName("undefined")).toBe(false);
    expect(isUsableClientName("null")).toBe(false);
  });
});

describe("booking accept is not presence", () => {
  it("keeps the inbound phone when the model passes undefined", () => {
    expect(resolveToolClientPhone("undefined", "5545988230845")).toBe("5545988230845");
    expect(resolveToolClientPhone("", "5545988230845")).toBe("5545988230845");
  });

  it("does not treat the WhatsApp push name as the person", () => {
    expect(
      confirmedPersonName({
        storedName: "Oficina",
        nameConfirmed: false,
        pushName: "Oficina",
      }),
    ).toBe("");
    expect(
      confirmedPersonName({
        statedThisTurn: "Mateus",
        storedName: "Oficina",
        nameConfirmed: false,
        pushName: "Oficina",
      }),
    ).toBe("Mateus");
  });

  it("blocks presence while a booking draft is open", () => {
    expect(bookingDraftBlocksPresence({ draftStatus: "offered", lastAssistantWasReminder: false })).toBe(true);
    expect(bookingDraftBlocksPresence({ draftStatus: "awaiting_name", lastAssistantWasReminder: false })).toBe(true);
    expect(bookingDraftBlocksPresence({ draftStatus: "offered", lastAssistantWasReminder: true })).toBe(false);
    expect(bookingDraftBlocksPresence({ draftStatus: "collecting", lastAssistantWasReminder: false })).toBe(false);
  });

  it("asks to move the existing slot instead of saying there is none", () => {
    expect(replyDeniesUpcoming("Parece que não há agendamentos futuros registrados no sistema.")).toBe(true);
  });

  it("does not repeat a PIX key already sent", () => {
    const echoed = "Aqui está a chave PIX da Cavalier: 45988432998";
    expect(replyWithoutPixEcho(echoed, "45988432998")).toBe("Te mandei a chave PIX aqui.");
    expect(replyWithoutPixEcho("Te mandei a chave PIX aqui.", "45988432998")).toBe("Te mandei a chave PIX aqui.");
  });

  it("closes a booking with the person's name", () => {
    const far = composeBookingCreated({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      when: "amanhã, segunda-feira (28/09) às 15h",
      barberName: "Lucas Lima",
      remindBefore: true,
    });
    expect(far).toMatch(/Agendado, Mateus!/);
    expect(far).toMatch(/está marcado para amanhã, segunda-feira \(28\/09\) às 15h, com o profissional Lucas/);
    expect(far).toContain("[[MSG]]");
    expect(far).toMatch(/lembrete 2h antes/);
    const soon = composeBookingCreated({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      when: "hoje, domingo (27/09) às 12h",
      barberName: "Lucas Lima",
      remindBefore: false,
    });
    expect(soon).not.toContain("[[MSG]]");
    expect(soon).not.toMatch(/lembrete 2h/);
    const when = formatMarkedWhen("2026-09-28", "15:00", "2026-09-27");
    expect(when).toBe("amanhã, segunda-feira (28/09) às 15h");
    const mins = minutesUntilAppointment({
      dateIso: "2026-09-28",
      timeHHmm: "15:00",
      todayIso: "2026-09-27",
      nowHHmm: "11:07",
    });
    expect(mins).toBeGreaterThanOrEqual(REMINDER_BUBBLE_LEAD_MINUTES);
    expect(
      minutesUntilAppointment({
        dateIso: "2026-09-27",
        timeHHmm: "13:00",
        todayIso: "2026-09-27",
        nowHHmm: "11:07",
      }),
    ).toBeLessThan(REMINDER_BUBBLE_LEAD_MINUTES);
    expect(
      composeRemarcarFromLast({
        firstName: "Mateus",
        serviceName: "Corte e Barba",
        barberName: "Lucas Lima",
        timeHHmm: "13:00",
      }),
    ).toMatch(/Mateus/);
    expect(
      composeRemarcarFromLast({
        firstName: "Mateus",
        serviceName: "Corte e Barba",
        barberName: "Lucas Lima",
        timeHHmm: "13:00",
      }),
    ).not.toMatch(/qual serviço/i);
  });
});

describe("allowedConfirmAppointmentIds", () => {
  it("accepts pending ids from upcoming and listed this turn", () => {
    const allowed = allowedConfirmAppointmentIds(
      [{ id: "6a4c8a8a-0c3b-4b7e-8b9f-2e5f3d8c3c1e", status: "pending" }],
      [],
    );
    expect(allowed.has("6a4c8a8a-0c3b-4b7e-8b9f-2e5f3d8c3c1e")).toBe(true);
    expect(allowed.has("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("rejects invented ids that were never listed", () => {
    const allowed = allowedConfirmAppointmentIds([], ["not-a-uuid"]);
    expect(allowed.size).toBe(0);
  });
});

describe("output guard", () => {
  const base = {
    previousAssistant: "",
    userText: "Quero agendar com o Lucas amanha as 6",
    opensAt: "09:00",
    closesAt: "19:00",
    composed: false,
  };

  it("silences error leaks instead of sending them", () => {
    expect(containsAiExposure("Parece que houve um erro ao tentar acessar seus agendamentos. Um momento, por favor.")).toBe(true);
    expect(containsAiExposure("Parece que o serviço que você deseja não está disponível para agendamento.")).toBe(true);
    expect(containsAiExposure("Posso não ter entendido. Quer agendar?")).toBe(true);
    expect(guardClientReply({ ...base, reply: "Parece que houve um erro ao tentar acessar seus agendamentos." })).toBe("");
  });

  it("silences a clock the shop window would shift", () => {
    expect(guardClientReply({ ...base, reply: "Qual deles você prefere para amanhã às 6h?" })).toBe("");
    expect(guardClientReply({ ...base, reply: "Tenho às 18h com o Lucas." })).toBe("Tenho às 18h com o Lucas.");
  });

  it("silences a repeat of the previous assistant bubble", () => {
    const same = "Neste horário o Lucas estará atendendo. Posso te encaixar com o Eduardo às 18h.";
    expect(guardClientReply({ ...base, reply: same, previousAssistant: same, composed: true })).toBe("");
  });

  it("keeps the presence sentence", () => {
    expect(composePresenceConfirmed({ firstName: "Mateus", when: "amanhã, 23/09 às 18h", barberName: "Lucas Lima" })).toBe(
      "✅ Presença confirmada, Mateus! Te esperamos amanhã, 23/09 às 18h com o Lucas Lima.",
    );
  });
});

describe("resolveServiceForTurn", () => {
  const catalog = [
    { id: "combo", name: "Corte e Barba", category: "combo" },
    { id: "corte", name: "Corte masculino", category: "corte" },
    { id: "barba", name: "Barba completa", category: "barba" },
  ];

  it("binds the habitual combo when the turn has no service", () => {
    expect(resolveServiceForTurn("Quero agendar com o Lucas amanha as 6", ["Corte e Barba"], catalog).match?.id).toBe("combo");
  });

  it("keeps an explicit corte e barba on the combo", () => {
    expect(resolveServiceForTurn("Corte e barba", [], catalog).match?.id).toBe("combo");
  });
});

// ── confirmedPersonName — regression Cavalier 25/09 ──────────────────────────
describe("confirmedPersonName", () => {
  it("returns stated name from current turn immediately (no confirmation needed)", () => {
    expect(confirmedPersonName({ statedThisTurn: "João Silva", nameConfirmed: false })).toBe("João Silva");
  });

  it("returns empty when not confirmed and no stated name", () => {
    expect(confirmedPersonName({ storedName: "João Silva", nameConfirmed: false })).toBe("");
  });

  it("returns stored name when confirmed, even if it matches push name (regression)", () => {
    // The bug: client named "João" explicitly in booking flow, push name also "João".
    // confirmedPersonName was discarding the confirmed name → agent re-asked for it.
    expect(
      confirmedPersonName({
        storedName: "João",
        nameConfirmed: true,
        pushName: "João",
      }),
    ).toBe("João");
  });

  it("returns stored name when confirmed and push name is the first word match (regression)", () => {
    expect(
      confirmedPersonName({
        storedName: "João",
        nameConfirmed: true,
        pushName: "João Silva",
      }),
    ).toBe("João");
  });

  it("returns stored name when confirmed regardless of push name", () => {
    expect(
      confirmedPersonName({
        storedName: "Maria",
        nameConfirmed: true,
        pushName: "Barbearia Central",
      }),
    ).toBe("Maria");
  });

  it("still rejects unusable stored names even when confirmed", () => {
    expect(confirmedPersonName({ storedName: "cliente", nameConfirmed: true })).toBe("");
    expect(confirmedPersonName({ storedName: "ok", nameConfirmed: true })).toBe("");
  });
});

// ── withBarberSubstitutionDisclosure — regression Cavalier 25/09 ───────────────
describe("withBarberSubstitutionDisclosure", () => {
  const barbers = [{ id: "eduardo-uuid", name: "Eduardo" }];

  it("adds disclosure when unknown barber named in current turn", () => {
    const out = withBarberSubstitutionDisclosure(
      "Eduardo tem horário às 14h",
      "quero com o Gabriel",
      barbers,
      "Eduardo",
    );
    expect(out).toContain("Gabriel");
    expect(out).toContain("Eduardo");
    expect(out).toContain("[[MSG]]");
  });

  it("does NOT add disclosure when offered barber matches requested", () => {
    const out = withBarberSubstitutionDisclosure(
      "Eduardo tem horário às 14h",
      "quero com o Eduardo",
      barbers,
      "Eduardo",
    );
    expect(out).not.toContain("[[MSG]]");
  });

  it("adds disclosure when unknown barber appeared in a PREVIOUS turn (regression)", () => {
    // The bug: turn 1 "com Gabriel" → turn 2 "corte e barba" (no barber name).
    // Slot offered with Eduardo but no disclosure because current turn has no barber name.
    const out = withBarberSubstitutionDisclosure(
      "Eduardo tem horário às 14h",
      "corte e barba",          // current turn — no barber name
      barbers,
      "Eduardo",
      ["quero com o Gabriel"],  // previous turn — named Gabriel
    );
    expect(out).toContain("Gabriel");
    expect(out).toContain("Eduardo");
    expect(out).toContain("[[MSG]]");
  });

  it("does NOT add disclosure when previous turn only named a known barber", () => {
    const out = withBarberSubstitutionDisclosure(
      "Eduardo tem horário às 14h",
      "corte e barba",
      barbers,
      "Eduardo",
      ["quero com o Eduardo"], // named Eduardo — known barber
    );
    expect(out).not.toContain("[[MSG]]");
  });
});

describe("replyNegotiatesUnverifiedSlots", () => {
  it("flags a menu of times or an unverified 'unavailable' claim", () => {
    expect(
      replyNegotiatesUnverifiedSlots(
        "Infelizmente, o horário das 16h também não está disponível. As opções são hoje às 14h30 e às 15h30.",
      ),
    ).toBe(true);
    expect(
      replyNegotiatesUnverifiedSlots("As opções disponíveis são hoje às 14h30, às 15h e às 15h30. Qual horário você prefere?"),
    ).toBe(true);
  });

  it("does not flag a single question that does not assert a slot", () => {
    expect(replyNegotiatesUnverifiedSlots("Qual horário você prefere?")).toBe(false);
    expect(replyNegotiatesUnverifiedSlots("Para confirmar, qual seu nome?")).toBe(false);
  });
});

describe("reschedule must not narrate a failure the tools did not return", () => {
  it("treats an occupied claim and a stuck reschedule as a leak", () => {
    expect(replyNarratesBookingFailure("Parece que o horário das 18h já está ocupado. Posso verificar outras opções para você?")).toBe(true);
    expect(
      replyNarratesBookingFailure(
        "Parece que não estou conseguindo reagendar seu horário para amanhã às 09h. Vou precisar de mais um momento para resolver isso. Um instante!",
      ),
    ).toBe(true);
    expect(replyNarratesBookingFailure("Mateus, fica assim, então: Corte e Barba às 18h. Posso confirmar?")).toBe(false);
  });

  it("does not write a stale draft when the accepted card names another clock", () => {
    const card = "Mateus, fica assim, então:\n📅 Amanhã, segunda 28/09 às 09h\nPosso confirmar?";
    expect(rescheduleDraftMatchesOffer("17:00", card)).toBe(false);
    expect(rescheduleDraftMatchesOffer("09:00", card)).toBe(true);
    expect(rescheduleDraftMatchesOffer("18:00", "Posso confirmar?")).toBe(true);
    expect(composeRescheduleDone({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      when: "amanhã, segunda-feira (28/09) às 18h",
      barberName: "Eduardo Gustavo",
    })).toMatch(/ficou para amanhã/);
  });
});

describe("location action text", () => {
  it("acknowledges the pin and offers help as two bubbles", () => {
    expect(splitOutgoingBubbles(composeLocationSent())).toEqual([
      "Enviei nossa localização",
      "Se precisar de mais alguma coisa, é só avisar!",
    ]);
  });
});

describe("pix answer keeps the price", () => {
  it("sends the key card and the receipt ask as two bubbles", () => {
    const out = composeShopPixReply({
      pixKey: "45988432998",
      keyType: "telefone",
      holderName: "Mateus",
      shopName: "Cavalier Barbearia",
      serviceName: "Corte e Barba",
      price: 55,
    });
    const [card, receipt] = out.split("[[MSG]]");
    expect(card).toBe(
      "Fica em R$ 55,00 o Corte e Barba. Segue a nossa chave PIX:\n\n" +
        "`\u2060\u202F45988432998\u202F\u2060`\n\n" +
        "_ (Chave tipo Celular • Nome: Mateus / Cavalier Barbearia)_",
    );
    expect(receipt).toMatch(/^Assim que realizar o pagamento/);
    expect(card).not.toMatch(/comprovante/);
  });

  it("drops the key echo and restores the booked price when the client asked", () => {
    const out = replyAfterPixCard({
      reply: "Corte e Barba fica R$ 55,00. A chave PIX é 45988432998.",
      pixKey: "45988432998",
      userText: "qual o valor e chave PIX?",
      price: 55,
    });
    expect(out).toMatch(/R\$ 55,00/);
    expect(out).not.toMatch(/45988432998/);
  });

  it("keeps a price line that does not repeat the key", () => {
    const out = replyWithoutPixEcho("O valor é R$ 55,00.\nChave PIX: 45988432998", "45988432998");
    expect(out).toBe("O valor é R$ 55,00.");
  });
});

describe("consult recap is not a booking claim", () => {
  it("answers when the appointment is from the row already on file", () => {
    const out = composeUpcomingRecap({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      when: "Segunda, 28/09 às 15h",
      barberName: "Lucas Lima",
      price: 55,
    });
    expect(out).toMatch(/segunda, 28\/09 às 15h/);
    expect(out).toMatch(/está agendado para/);
    expect(out).toMatch(/Corte e Barba/);
    expect(out).toMatch(/Lucas/);
    const [fact, closer] = out.split("[[MSG]]");
    expect(fact).not.toMatch(/cancelar ou reagendar/);
    expect(closer).toMatch(/cancelar ou reagendar/);
    expect(looksLikeHallucinatedBookingClaim(out)).toBe(false);
    expect(looksLikeHallucinatedBookingClaim("Seu horário está agendado para segunda.")).toBe(false);
    expect(looksLikeHallucinatedBookingClaim("Seu agendamento foi confirmado.")).toBe(true);
  });
});

describe("bare affirmation is not a presence confirmation", () => {
  it("only tags presence after a reminder, and flags the RSVP sentence", () => {
    const base = {
      text: "Pode",
      todayIso: "2026-09-27",
      services: [],
      barbers: [],
      conversationId: "conv-test",
    };
    expect(understandTurn({ ...base, previousState: "slot_offered" }).intents).not.toContain("presence");
    expect(understandTurn({ ...base, previousState: "reminder_2h_pending" }).primary).toBe("presence");
    expect(replyClaimsPresenceConfirmed("Presença confirmada, Mateus! Te esperamos amanhã, 28/09 às 17h.")).toBe(true);
    expect(replyClaimsPresenceConfirmed("Mateus, seu horário está agendado para amanhã.")).toBe(false);
  });
});

describe("time-only reschedule keeps the current barber", () => {
  const lucas = "a9354524-6859-40fb-9b52-f3b2ef322b35";
  const eduardo = "df811fd9-91e3-4060-8cf0-ad3cd4dfff5c";
  const catalogIds = [lucas, eduardo];

  it("ignores a tool id when the client did not name a barber", () => {
    expect(
      barberIdForAvailability({
        anyBarber: false,
        upcomingBarberId: lucas,
        toolBarberId: eduardo,
        catalogIds,
      }),
    ).toBe(lucas);
  });

  it("keeps the appointment barber when a stale draft names someone else", () => {
    expect(
      barberIdForAvailability({
        anyBarber: false,
        draftBarberId: lucas,
        upcomingBarberId: eduardo,
        toolBarberId: lucas,
        catalogIds,
      }),
    ).toBe(eduardo);
  });

  it("a failed check must not be read as a free slot", () => {
    expect(replyClaimsSlotIsFree("O Lucas está livre às 18h.")).toBe(true);
    expect(replyClaimsSlotIsFree("Qual serviço deseja?")).toBe(false);
  });

  it("checks a new clock before saying the appointment already moved", () => {
    const monday = { upcomingDate: "2026-09-28", upcomingTime: "17:00", date: "2026-09-28", opensAt: "09:00", closesAt: "19:00" };
    expect(pendingMoveSlot({ ...monday, userText: "Pode ser as 9" })).toEqual({ date: "2026-09-28", time: "09:00" });
    expect(pendingMoveSlot({ ...monday, userText: "Pode" })).toBeNull();
    expect(pendingMoveSlot({ ...monday, userText: "Pode ser as 17" })).toBeNull();
    const card = "Mateus, seu horário está agendado para amanhã, segunda 28/09 às 9h: Corte e Barba com o Lucas.\n\nPosso confirmar?";
    expect(
      affirmedUnverifiedClock({
        userText: "Sim",
        previousAssistant: card,
        affirmative: true,
        askedConfirmation: true,
        opensAt: "09:00",
        closesAt: "19:00",
      }),
    ).toBe("09:00");
    expect(replyClaimsOtherClock(card, "17:00")).toBe(true);
    expect(replyClaimsOtherClock(card, "09:00")).toBe(false);
  });

  it("uses the barber named this turn", () => {
    expect(
      barberIdForAvailability({
        namedBarberId: eduardo,
        anyBarber: false,
        upcomingBarberId: lucas,
        toolBarberId: lucas,
        catalogIds,
      }),
    ).toBe(eduardo);
  });
});

describe("done and cancel copy", () => {
  it("marks a saved booking and a reschedule, and not the draft card", () => {
    const booked = composeBookingCreated({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      when: "terça às 13h",
    });
    const moved = composeRescheduleDone({
      firstName: "Mateus",
      serviceName: "Corte e Barba",
      when: "terça às 13h",
    });
    const card = composeAvailableSlotConfirm({
      serviceName: "Corte e Barba",
      barberName: "Lucas Lima",
      dateIso: "2026-10-06",
      timeHHmm: "13:00",
      totalPrice: 55,
      todayIso: "2026-10-02",
    });
    expect(booked.startsWith("✅")).toBe(true);
    expect(moved.startsWith("✅")).toBe(true);
    expect(composePresenceConfirmed({ when: "amanhã às 10h" }).startsWith("✅")).toBe(true);
    expect(card).not.toContain("✅");
    expect(card).toContain("Posso confirmar?");
    expect(detectViolations(booked)).not.toContain("excessive_emojis");
  });

  it("marks a cancellation and does not ask to confirm it first", () => {
    const text = composeCancellationReply({
      serviceName: "Corte e Barba",
      when: "hoje às 18h",
      barberName: "Lucas Lima",
    });
    expect(text.startsWith("❌")).toBe(true);
    expect(text).toContain("cancelado");
    expect(text).not.toMatch(/posso confirmar/i);
  });
});
