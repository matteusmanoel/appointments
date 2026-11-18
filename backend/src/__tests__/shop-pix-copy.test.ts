import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMenu = vi.hoisted(() => vi.fn());
const getWhatsAppOrNull = vi.hoisted(() => vi.fn());

vi.mock("../integrations/whatsapp/index.js", () => ({
  getWhatsAppOrNull,
}));

import { sendShopPixCopy, shopPixCopyChoice } from "../lib/send-shop-pix-button.js";

describe("shop PIX copy button", () => {
  beforeEach(() => {
    sendMenu.mockReset();
    getWhatsAppOrNull.mockReset();
  });

  it("builds a single copy choice and does not mix a reply button", () => {
    expect(shopPixCopyChoice("lab@navalhia.com.br")).toBe("Copiar chave|copy:lab@navalhia.com.br");
    expect(shopPixCopyChoice("lab@navalhia.com.br")).not.toMatch(/\|(?!copy:)/);
  });

  it("sends /send/menu with the copy choice", async () => {
    getWhatsAppOrNull.mockResolvedValue({ sendMenu });
    sendMenu.mockResolvedValue(undefined);
    const result = await sendShopPixCopy("shop", "5545988230845", {
      text: "Fica em R$ 85,00 o Corte e Barba.",
      pixKey: "lab@navalhia.com.br",
      footerText: "NavalhIA Lab",
    });
    expect(result).toEqual({ sent: true });
    expect(sendMenu).toHaveBeenCalledWith({
      to: "5545988230845",
      text: "Fica em R$ 85,00 o Corte e Barba.",
      choices: ["Copiar chave|copy:lab@navalhia.com.br"],
      footerText: "NavalhIA Lab",
    });
  });

  it("falls back when the server refuses the menu", async () => {
    getWhatsAppOrNull.mockResolvedValue({ sendMenu });
    sendMenu.mockRejectedValue(new Error("HTTP 400"));
    const result = await sendShopPixCopy("shop", "5545988230845", {
      text: "Fica em R$ 85,00 o Corte e Barba.",
      pixKey: "lab@navalhia.com.br",
    });
    expect(result).toEqual({ sent: false, reason: "failed" });
  });
});
