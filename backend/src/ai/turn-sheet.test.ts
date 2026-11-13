import { describe, expect, it } from "vitest";
import { buildTurnSheetRow } from "./turn-sheet.js";

describe("buildTurnSheetRow", () => {
  it("mascara o telefone e descarta prompt, mensagens e argumentos de tool", () => {
    const row = buildTurnSheetRow({
      jobId: "11111111-1111-1111-1111-111111111111",
      conversationId: "22222222-2222-2222-2222-222222222222",
      barbershopId: "33333333-3333-3333-3333-333333333333",
      at: "2026-10-02T12:35:01.667Z",
      phone: "5545988230845",
      inboundPreview: "Mateus",
      replyPreview: "Para confirmar, qual seu nome?",
      prompt: "SYSTEM SECRET com a instrução inteira",
      messages: [{ role: "system", content: "não gravar isto" }],
      openai: [
        {
          round: 0,
          toolsRequested: ["create_appointment"],
          prompt: "hidden prompt",
          messages: [{ content: "também escondido" }],
        },
      ],
      toolsExecuted: [
        {
          name: "create_appointment",
          ok: false,
          arguments: { client_phone: "5545988230845", note: "argumento cru" },
        },
      ],
      routing: {
        primaryIntent: "unknown",
        applied: ["no_recording", "tool_not_in_plan"],
        allowedTools: [],
        system: "não entra",
      },
      intent: { primary: "unknown", intents: ["unknown"], confidence: 0.1, service: null, barber: null, date: null, time: null },
      silencedBy: "ai_exposure",
      decisionOwner: "orchestrator",
      canonicalState: "slot_offered",
      conversationState: "offer_awaiting_confirm",
      outbound: { status: "empty_reply" },
    });

    expect(row).not.toBeNull();
    const encoded = JSON.stringify(row);
    expect(encoded).not.toContain("5545988230845");
    expect(encoded).not.toContain("SYSTEM SECRET");
    expect(encoded).not.toContain("não gravar");
    expect(encoded).not.toContain("hidden prompt");
    expect(encoded).not.toContain("argumento cru");
    expect(encoded).not.toContain("não entra");
    expect(row?.phoneMask).toBe("***0845");
    expect(row?.toolsRequested).toEqual(["create_appointment"]);
    expect(row?.toolsExecuted).toEqual([{ name: "create_appointment", ok: false }]);
    expect(row?.routing?.applied).toEqual(["no_recording", "tool_not_in_plan"]);
    expect(row?.silencedBy).toBe("ai_exposure");
  });

  it("recusa linha sem job, conversa ou loja", () => {
    expect(buildTurnSheetRow({ phone: "5545988230845", prompt: "segredo" })).toBeNull();
  });
});
