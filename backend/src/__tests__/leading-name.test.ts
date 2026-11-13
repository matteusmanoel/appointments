import { describe, expect, it } from "vitest";
import { extractLeadingAddressedName } from "../ai/agent.js";

const ctx = {
  todayIso: "2026-09-26",
  serviceNames: ["Corte masculino", "Barba", "Corte + Barba", "Pigmentação"],
  barberNames: ["Lucas", "Rafael Souza"],
  shopName: "Barbearia do Zé",
};

describe("extractLeadingAddressedName", () => {
  it("captures the name opening a full booking request (real case)", () => {
    expect(extractLeadingAddressedName("Mateus, corte e barba com o Lucas amanhã às 15h", ctx)).toBe("Mateus");
  });

  it("captures a two-word name with different booking wording", () => {
    expect(extractLeadingAddressedName("Ana Paula. Queria marcar uma pigmentação sexta de manhã", ctx)).toBe(
      "Ana Paula",
    );
  });

  it("captures the name before a reschedule request", () => {
    expect(extractLeadingAddressedName("Joaquim: dá pra remarcar meu horário pra quinta 10h?", ctx)).toBe("Joaquim");
  });

  it("ignores greetings and vocatives", () => {
    expect(extractLeadingAddressedName("Bom dia, quero cortar amanhã às 15h", ctx)).toBeNull();
    expect(extractLeadingAddressedName("Opa, tem horário hoje 18h?", ctx)).toBeNull();
    expect(extractLeadingAddressedName("Mano, quero marcar um corte amanhã", ctx)).toBeNull();
    expect(extractLeadingAddressedName("Obrigado, amanhã às 15h então", ctx)).toBeNull();
  });

  it("does not take a barber, service or the shop as the client's name", () => {
    expect(extractLeadingAddressedName("Lucas, tem horário amanhã às 15h?", ctx)).toBeNull();
    expect(extractLeadingAddressedName("Rafael, consegue sexta 9h?", ctx)).toBeNull();
    expect(extractLeadingAddressedName("Barba, amanhã às 10h", ctx)).toBeNull();
  });

  it("requires a booking signal in the rest of the message", () => {
    expect(extractLeadingAddressedName("Mateus, tudo certo por aí?", ctx)).toBeNull();
    expect(extractLeadingAddressedName("Mateus", ctx)).toBeNull();
  });
});
