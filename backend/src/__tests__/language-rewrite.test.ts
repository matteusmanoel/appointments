import { describe, expect, it } from "vitest";
import {
  isLanguageRewriteEnabled,
  rewriteLooksLikeSafeFallback,
  templateFactsPreserved,
} from "../ai/agent/language-rewrite.js";

const TEMPLATE =
  "Consigo te atender amanhã às 13h, às 13h30 e às 14h. Qual prefere?";

describe("isLanguageRewriteEnabled", () => {
  it("fica desligada por padrão e só liga com override explícito", () => {
    const previous = process.env.AI_AGENT_LANGUAGE_REWRITE;
    delete process.env.AI_AGENT_LANGUAGE_REWRITE;
    expect(isLanguageRewriteEnabled()).toBe(false);
    expect(isLanguageRewriteEnabled(true)).toBe(true);
    expect(isLanguageRewriteEnabled(false)).toBe(false);
    if (previous === undefined) delete process.env.AI_AGENT_LANGUAGE_REWRITE;
    else process.env.AI_AGENT_LANGUAGE_REWRITE = previous;
  });
});

describe("templateFactsPreserved", () => {
  const catalog = ["Corte masculino", "Barba", "Pigmentação"];

  it("aceita reescrita simpática que mantém os horários e o serviço do template", () => {
    const rewritten =
      "Posso te encaixar amanhã às 13h, às 13h30 ou às 14h no Corte masculino. Qual fica melhor?";
    const template = `${TEMPLATE} Corte masculino`;
    expect(templateFactsPreserved(template, rewritten, catalog)).toBe(true);
  });

  it("rejeita relógio ou serviço inventado e cai no template puro", () => {
    expect(templateFactsPreserved(TEMPLATE, "Tenho às 11h também, pode ser?", catalog)).toBe(false);
    expect(
      templateFactsPreserved(
        `${TEMPLATE} Corte masculino`,
        "Consigo Pigmentação amanhã às 13h.",
        catalog,
      ),
    ).toBe(false);
  });

  it("rejeita data, preço ou barbeiro inventados", () => {
    const template =
      "Fica assim: Corte masculino com o Lucas amanhã às 15h, R$ 35,00. Posso confirmar?";
    const barbers = ["Lucas", "Eduardo Gustavo"];
    const services = ["Corte masculino", "Barba"];
    expect(
      templateFactsPreserved(
        template,
        "Fica assim: Corte masculino com o Lucas amanhã às 15h, R$ 35,00. Posso confirmar?",
        services,
        barbers,
      ),
    ).toBe(true);
    expect(
      templateFactsPreserved(
        template,
        "Fica assim: Corte masculino com o Lucas segunda às 15h, R$ 35,00. Posso confirmar?",
        services,
        barbers,
      ),
    ).toBe(false);
    expect(
      templateFactsPreserved(
        template,
        "Fica assim: Corte masculino com o Lucas amanhã às 15h, R$ 90,00. Posso confirmar?",
        services,
        barbers,
      ),
    ).toBe(false);
    expect(
      templateFactsPreserved(
        template,
        "Fica assim: Corte masculino com o Eduardo Gustavo amanhã às 15h, R$ 35,00. Posso confirmar?",
        services,
        barbers,
      ),
    ).toBe(false);
  });
});

describe("rewriteLooksLikeSafeFallback", () => {
  it("não aceita SAFE_CLIENT_FALLBACK como saída reescrita", () => {
    const fallback = "Me diz um horário que te atenda, ou a gente vê as próximas vagas.";
    expect(rewriteLooksLikeSafeFallback(fallback, [fallback])).toBe(true);
    expect(rewriteLooksLikeSafeFallback("Posso confirmar o corte amanhã às 15h?", [fallback])).toBe(false);
  });
});
