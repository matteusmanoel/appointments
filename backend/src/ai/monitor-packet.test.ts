import { describe, expect, it } from "vitest";
import { attachLabContext, isCandidate, selectMonitorPacket, type MonitorSheet } from "./monitor-packet.js";

function sheet(partial: Partial<MonitorSheet> & Pick<MonitorSheet, "jobId" | "conversationId" | "at" | "inboundPreview">): MonitorSheet {
  return {
    replyPreview: "",
    phoneMask: "***0845",
    decisionOwner: "orchestrator",
    canonicalState: "idle",
    conversationState: "idle",
    intentPrimary: "unknown",
    intentService: null,
    intentTime: null,
    intentBarber: null,
    applied: ["no_recording"],
    allowedTools: [],
    toolsRequested: [],
    toolsExecuted: [],
    silencedBy: null,
    ...partial,
  };
}

describe("selectMonitorPacket", () => {
  const greeting = sheet({
    jobId: "g-job",
    conversationId: "conv-greeting",
    at: "2026-10-02T12:33:31.000Z",
    inboundPreview: "Olá, tudo bem?",
    replyPreview: "Olá! Seja bem-vindo.",
    intentPrimary: "unknown",
    canonicalState: "idle",
  });

  const check = sheet({
    jobId: "check-job",
    conversationId: "conv-sim",
    at: "2026-10-02T13:02:10.000Z",
    inboundPreview: "Quero agendar corte e barba amanhã às 10h com o Lucas",
    replyPreview: "10h30 com ele está livre. Quer esse?",
    decisionOwner: "llm_tool_loop",
    intentPrimary: "schedule",
    intentService: "Corte e Barba",
    intentTime: "10:00",
    intentBarber: "Lucas Lima",
    applied: [],
    allowedTools: ["check_availability"],
    toolsRequested: ["check_availability"],
    toolsExecuted: [{ name: "check_availability", ok: true }],
    canonicalState: "idle",
  });

  const sim = sheet({
    jobId: "sim-job",
    conversationId: "conv-sim",
    at: "2026-10-02T13:02:35.000Z",
    inboundPreview: "Sim",
    replyPreview: "Qual serviço deseja?",
    canonicalState: "idle",
    intentPrimary: "unknown",
    applied: ["no_recording"],
  });

  const mateusA = sheet({
    jobId: "name-a",
    conversationId: "conv-name-a",
    at: "2026-10-02T12:35:01.000Z",
    inboundPreview: "Mateus",
    replyPreview: "",
    canonicalState: "slot_offered",
    conversationState: "offer_awaiting_confirm",
    silencedBy: "ai_exposure",
    applied: ["no_recording", "tool_not_in_plan"],
    toolsRequested: ["create_appointment"],
    toolsExecuted: [{ name: "create_appointment", ok: false }],
  });

  const mateusB = sheet({
    ...mateusA,
    jobId: "name-b",
    conversationId: "conv-name-b",
    at: "2026-10-02T12:40:00.000Z",
  });

  it("separa o nome calado do sim ocioso e deixa a saudação de fora", () => {
    const packet = selectMonitorPacket([greeting, check, sim, mateusA, mateusB], "2026-10-02T16:00:00.000Z");
    const signatures = packet.groups.map((group) => group.signature);
    expect(packet.groups.length).toBeGreaterThanOrEqual(2);
    expect(signatures.some((key) => key.includes("ai_exposure") && key.includes("tool_not_in_plan"))).toBe(true);
    expect(signatures.some((key) => key.includes("after_check") && key.includes("idle"))).toBe(true);
    expect(packet.groups.some((group) => group.exemplar.some((turn) => turn.jobId === "g-job") && group.turnCount === 1 && group.exemplar.length === 1 && group.exemplar[0]?.inboundPreview.startsWith("Olá"))).toBe(false);
    const nameGroup = packet.groups.find((group) => group.signature.includes("ai_exposure"));
    const simGroup = packet.groups.find((group) => group.signature.includes("after_check"));
    expect(nameGroup?.recurrence).toBe("recorrente");
    expect(nameGroup?.conversationCount).toBe(2);
    expect(simGroup?.recurrence).toBe("pontual");
    expect(isCandidate(greeting, undefined)).toBe(false);
  });

  it("corta em 8 grupos", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      sheet({
        jobId: `job-${index}`,
        conversationId: `conv-${index}`,
        at: `2026-10-02T14:${String(index).padStart(2, "0")}:00.000Z`,
        inboundPreview: "Mateus",
        silencedBy: "ai_exposure",
        applied: ["tool_not_in_plan"],
        canonicalState: `state-${index}`,
      }),
    );
    const packet = selectMonitorPacket(many);
    expect(packet.groups).toHaveLength(8);
    expect(packet.omittedGroups).toBe(2);
  });

  it("põe a quebra de contrato na frente de consultas que deram certo", () => {
    const successes = Array.from({ length: 9 }, (_, index) =>
      sheet({
        jobId: `ok-${index}`,
        conversationId: `conv-ok-${index}`,
        at: `2026-10-02T15:${String(index).padStart(2, "0")}:00.000Z`,
        inboundPreview: "Quero cortar",
        intentPrimary: "schedule",
        applied: [],
        allowedTools: ["check_availability"],
        toolsRequested: ["check_availability"],
        toolsExecuted: [{ name: "check_availability", ok: true }],
        canonicalState: `livre-${index}`,
      }),
    );
    const silenced = sheet({
      jobId: "name-only",
      conversationId: "conv-name-only",
      at: "2026-10-02T15:30:00.000Z",
      inboundPreview: "Mateus",
      silencedBy: "ai_exposure",
      applied: ["no_recording", "tool_not_in_plan"],
      canonicalState: "slot_offered",
      toolsRequested: ["create_appointment"],
      toolsExecuted: [{ name: "create_appointment", ok: false }],
    });
    const packet = selectMonitorPacket([...successes, silenced]);
    expect(packet.groups[0]?.signature).toContain("ai_exposure");
    expect(packet.groups.some((group) => group.exemplar.some((turn) => turn.jobId === "name-only"))).toBe(true);
  });

  it("cola o cenário pelo instante e pela fala, não pelo texto solto", () => {
    const attached = attachLabContext([mateusA], [
      {
        id: "g03-agenda-lucas-segunda-10h",
        startedAt: "2026-10-02T12:34:00.000Z",
        turns: ["Quero agendar", "Sim", "Mateus"],
        priorState: "Sem nome da pessoa.",
        simulatedNow: "2026-09-19T22:54:00-03:00",
      },
      {
        id: "g04-consultar-horario",
        startedAt: "2026-10-02T12:36:00.000Z",
        turns: ["Gostaria de consultar meu agendamento"],
        priorState: "Horário já marcado.",
        simulatedNow: "2026-09-20T06:56:00-03:00",
      },
    ]);
    expect(attached[0]?.scenarioId).toBe("g03-agenda-lucas-segunda-10h");
    expect(attached[0]?.priorState).toBe("Sem nome da pessoa.");
    expect(attached[0]?.simulatedNow).toBe("2026-09-19T22:54:00-03:00");
  });
});
