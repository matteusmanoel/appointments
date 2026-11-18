import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const getWhatsAppOrNull = vi.fn();

vi.mock("../db.js", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));
vi.mock("../integrations/whatsapp/index.js", () => ({
  getWhatsAppOrNull: (...args: unknown[]) => getWhatsAppOrNull(...args),
}));

const { sendShopPixButton } = await import("../lib/send-shop-pix-button.js");

describe("sendShopPixButton", () => {
  beforeEach(() => {
    query.mockResolvedValue({
      rows: [{ name: "Barbearia Lab", address: "Rua A, 10, Cascavel", pix_key: "pix@lab.test" }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    query.mockReset();
    getWhatsAppOrNull.mockReset();
  });

  it("envia o botão com a chave, o valor e a cidade da barbearia", async () => {
    const sendPixRequest = vi.fn().mockResolvedValue(undefined);
    getWhatsAppOrNull.mockResolvedValue({ sendPixRequest });

    const out = await sendShopPixButton("shop", "+55 45 98823-0845", { amount: 85, description: "Corte e Barba" });

    expect(out).toEqual({ sent: true });
    expect(sendPixRequest).toHaveBeenCalledWith({
      to: "5545988230845",
      amount: 85,
      description: "Corte e Barba",
      pixKey: "pix@lab.test",
      name: "Barbearia Lab",
      city: "Cascavel",
    });
  });

  it("servidor que recusa: devolve falha e o log leva o status, não a chave", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getWhatsAppOrNull.mockResolvedValue({
      sendPixRequest: vi.fn().mockRejectedValue(new Error("Uazapi send/request-payment falhou. HTTP 405.")),
    });

    const out = await sendShopPixButton("shop", "5545988230845", { amount: 85, description: "Corte e Barba" });

    expect(out).toEqual({ sent: false, reason: "failed" });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/HTTP 405/);
    expect(logged).not.toMatch(/pix@lab\.test/);
  });

  it("provedor sem botão nativo ou sem chave: não tenta", async () => {
    getWhatsAppOrNull.mockResolvedValue({});
    expect(await sendShopPixButton("shop", "5545988230845", { amount: 85, description: "x" })).toEqual({
      sent: false,
      reason: "unsupported",
    });

    query.mockResolvedValue({ rows: [{ name: "Lab", address: null, pix_key: " " }] });
    expect(await sendShopPixButton("shop", "5545988230845", { amount: 85, description: "x" })).toEqual({
      sent: false,
      reason: "no_key",
    });
  });
});
