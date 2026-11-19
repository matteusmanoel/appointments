import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CatalogBarber, CatalogService } from "../../booking-draft.js";
import { understandTurn } from "../understanding.js";
import { CRITICAL_CASES, UNDERSTANDING_CASES } from "./understanding-dataset.js";
import { scoreUnderstanding, type UnderstandingScore } from "./understanding-eval.js";

const services: CatalogService[] = [
  { id: "s1", name: "Corte masculino", price: 35 },
  { id: "s2", name: "Barba completa", price: 25 },
  { id: "s3", name: "Corte e Barba", price: 55 },
];
const barbers: CatalogBarber[] = [
  { id: "b1", name: "Lucas Lima" },
  { id: "b2", name: "Eduardo Gustavo" },
];

describe("entendimento por regras na base rotulada", () => {
  let score: UnderstandingScore;

  beforeAll(() => {
    // Frase não entendida gera sugestão em arquivo: a avaliação não escreve no disco.
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    vi.spyOn(fs, "appendFileSync").mockImplementation(() => undefined);
    score = scoreUnderstanding((text, previousState) =>
      understandTurn({ text, todayIso: "2026-11-18", services, barbers, previousState }),
    );
  });

  it("tem volume para comparar interpretadores", () => {
    expect(UNDERSTANDING_CASES.length).toBeGreaterThanOrEqual(200);
    expect(new Set(UNDERSTANDING_CASES.map((c) => `${c.state ?? "idle"}:${c.text}`)).size).toBe(UNDERSTANDING_CASES.length);
    expect(CRITICAL_CASES.length).toBeGreaterThanOrEqual(15);
  });

  // Piso medido em 18/11/2026. Só sobe: é a régua que o interpretador por LLM precisa superar na Fase 1.
  it("não piora a linha de base", () => {
    expect(score.total).toBe(201);
    expect(score.correct).toBeGreaterThanOrEqual(116);
    expect(score.criticalViolations.length).toBeLessThanOrEqual(9);
  });
});
