import { describe, it, expect } from "vitest";
import {
  resolveWhatsAppProvider,
  instancePrefix,
  evolutionInstanceNameFor,
  isOwnInstanceName,
  whatsappConfigProblems,
} from "../integrations/whatsapp/provider-config.js";

const BID = "123e4567-e89b-12d3-a456-426614174000";

describe("provider de WhatsApp configurável", () => {
  it("padrão é evolution, mesmo sem nenhuma env", () => {
    expect(resolveWhatsAppProvider({})).toBe("evolution");
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "" })).toBe("evolution");
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "lixo" })).toBe("evolution");
  });
  it("respeita escolha explícita (case-insensitive)", () => {
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: "uazapi" })).toBe("uazapi");
    expect(resolveWhatsAppProvider({ WHATSAPP_PROVIDER: " Evolution " })).toBe("evolution");
  });
  it("instâncias novas levam o prefixo da NavalhIA; prefixo é configurável e sanitizado", () => {
    expect(evolutionInstanceNameFor(BID, null, {})).toBe("navalhia-123e4567e89b12d3");
    expect(evolutionInstanceNameFor(BID, null, { WHATSAPP_INSTANCE_PREFIX: "Navalhia Stg!" })).toBe("navalhiastg-123e4567e89b12d3");
    expect(instancePrefix({ WHATSAPP_INSTANCE_PREFIX: "!!!" })).toBe("navalhia");
  });
  it("instância já gravada no banco (inclusive legado nh-) nunca é renomeada", () => {
    expect(evolutionInstanceNameFor(BID, "nh-abc", {})).toBe("nh-abc");
  });
  it("isOwnInstanceName reconhece só instâncias da NavalhIA (atual ou legado)", () => {
    expect(isOwnInstanceName("navalhia-123", {})).toBe(true);
    expect(isOwnInstanceName("nh-123", {})).toBe(true);
    expect(isOwnInstanceName("outro-app-123", {})).toBe(false);
  });
  it("avisa configuração incompleta do provider escolhido (host externo e chave)", () => {
    expect(whatsappConfigProblems({})).toEqual(
      expect.arrayContaining([expect.stringContaining("EVOLUTION_API_URL"), expect.stringContaining("EVOLUTION_API_KEY")]),
    );
    expect(
      whatsappConfigProblems({ EVOLUTION_API_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", APP_URL: "https://x" }),
    ).toEqual([]);
    expect(whatsappConfigProblems({ WHATSAPP_PROVIDER: "uazapi" })).toEqual(
      expect.arrayContaining([expect.stringContaining("UAZAPI_BASE_URL")]),
    );
  });
});
