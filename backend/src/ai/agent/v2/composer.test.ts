import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { canPolish, HANDOFF_REPLY, polishReply, templateFor, type ComposeData } from "./composer.js";
import { EMPTY_CONTEXT } from "./machine.js";

const offer = "Fica assim:\n\n✂️ *Corte masculino*\n💈 *Lucas Lima*\n📅 Amanhã às 15h\n💰 R$ 35,00[[MSG]]Posso confirmar?";
const params = { tone: "curto", recentReplies: [], services: ["Corte masculino", "Barba completa"], barbers: ["Lucas Lima", "Eduardo Gustavo"] };
const modelSays = (content: string) =>
  ({ chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } } }) as unknown as OpenAI;
const data = (say: ComposeData["say"]): ComposeData => ({
  say,
  context: EMPTY_CONTEXT,
  upcoming: [],
  todayIso: "2026-11-18",
  nowHHmm: "10:00",
  social: "none",
  services: ["Corte masculino", "Corte e Barba"],
  barbersByName: ["Lucas Lima"],
});

describe("polishReply", () => {
  it("aceita outra redação com os mesmos fatos", async () => {
    const text = "Show! *Corte masculino* com *Lucas Lima* amanhã às 15h, por R$ 35,00.[[MSG]]Fechamos assim?";
    await expect(polishReply(modelSays(text), offer, params)).resolves.toBe(text);
  });

  it.each([
    ["hora", "*Corte masculino* com *Lucas Lima* amanhã às 16h, R$ 35,00. Fechamos?"],
    ["preço", "*Corte masculino* com *Lucas Lima* amanhã às 15h, R$ 30,00. Fechamos?"],
    ["barbeiro", "*Corte masculino* com *Eduardo Gustavo* amanhã às 15h, R$ 35,00. Fechamos?"],
    ["serviço", "*Barba completa* com *Lucas Lima* amanhã às 15h, R$ 35,00. Fechamos?"],
    ["dia", "*Corte masculino* com *Lucas Lima* sexta às 15h, R$ 35,00. Fechamos?"],
  ])("volta ao template quando o modelo muda %s", async (_label, text) => {
    await expect(polishReply(modelSays(text), offer, params)).resolves.toBe(offer);
  });

  it("volta ao template quando some a pergunta", async () => {
    await expect(polishReply(modelSays("Corte masculino com Lucas Lima amanhã às 15h, R$ 35,00."), offer, params)).resolves.toBe(offer);
  });

  it("volta ao template quando a API falha", async () => {
    const openai = { chat: { completions: { create: vi.fn().mockRejectedValue(new Error("fora")) } } } as unknown as OpenAI;
    await expect(polishReply(openai, offer, params)).resolves.toBe(offer);
  });
});

describe("templateFor", () => {
  it("não deixa o modelo reescrever confirmações de escrita", () => {
    for (const kind of ["booked", "moved", "cancelled", "presence_confirmed", "handoff"] as const) expect(canPolish(kind)).toBe(false);
    expect(canPolish("ask_service")).toBe(true);
  });

  it("responde saudação e agradecimento sem pedir ação", () => {
    expect(templateFor({ ...data({ kind: "clarify" }), social: "thanks" })).toContain("Por nada");
    expect(templateFor({ ...data({ kind: "clarify" }), social: "greeting" })).toContain("Olá");
  });

  it("mantém o texto fixo do atendimento humano", () => {
    expect(templateFor(data({ kind: "handoff" }))).toBe(HANDOFF_REPLY);
  });
});
