import { describe, it, expect } from "vitest";
import { detectViolations, sanitizeClientFacingReply, composeAvailableSlotConfirm, looksLikeBookingConfirmationAsk, containsAiExposure, assistantMessageAskedForName, isUsableClientName, withBarberSubstitutionDisclosure, allowedConfirmAppointmentIds, guardClientReply, resolveServiceForTurn, composePresenceConfirmed, resolveToolClientPhone, confirmedPersonName, bookingDraftBlocksPresence, replyDeniesUpcoming, replyWithoutPixEcho, composeBookingCreated, composeRemarcarFromLast } from "../ai/agent.js";

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
    expect(
      composeBookingCreated({
        firstName: "Mateus",
        serviceName: "Corte e Barba",
        when: "amanhã, 25/09 às 17h",
        barberName: "Eduardo Gustavo",
      }),
    ).toMatch(/Agendado, Mateus/);
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
      "Presença confirmada, Mateus! Te esperamos amanhã, 23/09 às 18h com o Lucas Lima.",
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
