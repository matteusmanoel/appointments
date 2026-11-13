import { describe, it, expect } from "vitest";
import {
  validateCheckoutForm,
  validateCheckoutField,
  firstInvalidField,
  checkoutErrorMessage,
  CHECKOUT_FALLBACK_ERROR,
} from "./checkout-validation";

const ok = { barbershop_name: "Barbearia do João", cnpj: "", phone: "11987654321", email: "joao@email.com" };

describe("validação do checkout (botão nunca fica cinza sem motivo)", () => {
  it("formulário válido não tem erros; CNPJ é opcional", () => {
    expect(validateCheckoutForm(ok)).toEqual({});
    expect(validateCheckoutForm({ ...ok, cnpj: "12345678000190" })).toEqual({});
  });

  it("formulário vazio devolve uma mensagem por campo obrigatório e o primeiro inválido é o nome", () => {
    const errors = validateCheckoutForm({ barbershop_name: "", cnpj: "", phone: "", email: "" });
    expect(Object.keys(errors).sort()).toEqual(["barbershop_name", "email", "phone"]);
    expect(firstInvalidField(errors)).toBe("barbershop_name");
  });

  it("CNPJ incompleto e telefone sem DDD mostram mensagem clara", () => {
    expect(validateCheckoutField("cnpj", { ...ok, cnpj: "123456" })).toMatch(/14 dígitos/);
    expect(validateCheckoutField("phone", { ...ok, phone: "987654321" })).toMatch(/DDD/);
    expect(validateCheckoutField("email", { ...ok, email: "joao@email" })).toMatch(/inválido/i);
    expect(firstInvalidField(validateCheckoutForm({ ...ok, phone: "1", email: "x" }))).toBe("phone");
  });
});

describe("mensagens de erro do servidor", () => {
  it("texto técnico/inglês/vazio/longo vira a mensagem padrão", () => {
    for (const m of ["Internal Server Error", "Failed to fetch", "Invalid body", "", "Bad Gateway", "x".repeat(300), "ECONNRESET"]) {
      expect(checkoutErrorMessage(new Error(m))).toBe(CHECKOUT_FALLBACK_ERROR);
    }
    expect(checkoutErrorMessage("string solta")).toBe(CHECKOUT_FALLBACK_ERROR);
  });
  it("mensagem curta em português escrita para o usuário passa", () => {
    expect(checkoutErrorMessage(new Error("Já existe uma conta com este e-mail."))).toBe("Já existe uma conta com este e-mail.");
  });
  it("a mensagem padrão sugere WhatsApp", () => {
    expect(CHECKOUT_FALLBACK_ERROR).toMatch(/WhatsApp/);
  });
});
