import { describe, expect, it } from "vitest";
import { understandTurn } from "./understanding.js";
import type { CatalogBarber, CatalogService } from "../booking-draft.js";

const services: CatalogService[] = [
  { id: "d4ad6587-1437-4853-b6f0-8d059485b99d", name: "Corte masculino" },
  { id: "522142c0-7621-4f88-825b-ad5f0c82c6a5", name: "Corte e Barba", category: "combo" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Sobrancelha" },
];
const barbers: CatalogBarber[] = [
  { id: "a9354524-6859-40fb-9b52-f3b2ef322b35", name: "Lucas Lima" },
];

function turn(text: string) {
  return understandTurn({
    text,
    todayIso: "2026-10-01",
    services,
    barbers,
    previousState: "idle",
  });
}

describe("understandTurn clock without a booking verb", () => {
  it("treats a catalog service plus a clock as schedule", () => {
    expect(turn("Corte e barba amanhã às 17h com o Lucas").primary).toBe("schedule");
  });

  it("treats another catalog service plus a clock the same way", () => {
    expect(turn("Sobrancelha sexta às 9").primary).toBe("schedule");
  });

  it("a PIX request with gostaria is payment, not a new hour", () => {
    const intent = turn("Pode me mandar a chave PIX por gentileza. Gostaria de já deixar certo");
    expect(intent.primary).toBe("payment");
    expect(intent.intents).not.toContain("schedule");
  });

  it("a booking that also asks for PIX stays a booking", () => {
    const intent = turn("Quero corte e barba amanhã às 10h e me manda o PIX");
    expect(intent.primary).toBe("schedule");
    expect(intent.intents).toContain("payment");
  });

  it("leaves a bare clock unknown so the turn can ask for the service", () => {
    const intent = turn("Às 6");
    expect(intent.primary).toBe("unknown");
    expect(intent.dateTime?.time).toBe("06:00");
  });
});
