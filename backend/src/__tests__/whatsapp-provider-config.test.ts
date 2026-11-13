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
      whatsappConfigProblems({ EVOLUTION_API_URL: "https://evo.example.com", EVOLUTION_API_KEY: "k", APP_URL: "https://x", WHATSAPP_WEBHOOK_SECRET: "s" }),
    ).toEqual([]);
    expect(whatsappConfigProblems({ WHATSAPP_PROVIDER: "uazapi" })).toEqual(
      expect.arrayContaining([expect.stringContaining("UAZAPI_BASE_URL")]),
    );
  });
});

import { providerDefaultNotice, startupWhatsappWarnings } from "../integrations/whatsapp/provider-config.js";

describe("aviso de mudança do provider padrão e segredos de webhook", () => {
  it("sem WHATSAPP_PROVIDER: avisa que o padrão passou de uazapi para evolution", () => {
    const n = providerDefaultNotice({});
    expect(n).toContain('padrão "evolution"');
    expect(n).toContain("uazapi");
    expect(providerDefaultNotice({ WHATSAPP_PROVIDER: "lixo" })).toContain("inválido");
  });
  it("com provider explícito não há aviso de padrão", () => {
    expect(providerDefaultNotice({ WHATSAPP_PROVIDER: "evolution" })).toBeNull();
    expect(providerDefaultNotice({ WHATSAPP_PROVIDER: "UAZAPI" })).toBeNull();
  });
  it("texto de EVOLUTION_API_KEY vazio é preciso: não diz que o webhook depende da chave", () => {
    const msg = whatsappConfigProblems({}).find((p) => p.includes("EVOLUTION_API_KEY"))!;
    expect(msg).toContain("autentica a chamada à API");
    expect(msg).not.toContain("falham fechados");
  });
  it("avisa WHATSAPP_WEBHOOK_SECRET ausente , e que a chave mestra não serve", () => {
    const p = whatsappConfigProblems({ WHATSAPP_PROVIDER: "uazapi", UAZAPI_BASE_URL: "u", UAZAPI_ADMIN_TOKEN: "t" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("WHATSAPP_WEBHOOK_SECRET");
    expect(p[0]).toContain("EVOLUTION_API_KEY");
    expect(whatsappConfigProblems({ WHATSAPP_PROVIDER: "uazapi", UAZAPI_BASE_URL: "u", UAZAPI_ADMIN_TOKEN: "t", WHATSAPP_WEBHOOK_SECRET: "s" })).toEqual([]);
  });
  it("Meta em uso exige WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN; sem Meta não incomoda", () => {
    const base = { WHATSAPP_PROVIDER: "uazapi", UAZAPI_BASE_URL: "u", UAZAPI_ADMIN_TOKEN: "t", WHATSAPP_WEBHOOK_SECRET: "s" };
    expect(whatsappConfigProblems(base)).toEqual([]);
    const meta = whatsappConfigProblems({ ...base, WHATSAPP_ACCESS_TOKEN: "x" });
    expect(meta.join("|")).toContain("WHATSAPP_APP_SECRET");
    expect(meta.join("|")).toContain("WHATSAPP_VERIFY_TOKEN");
    expect(whatsappConfigProblems({ ...base, WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_APP_SECRET: "a", WHATSAPP_VERIFY_TOKEN: "v" })).toEqual([]);
  });
  it("startupWhatsappWarnings junta aviso de padrão e problemas", () => {
    const lines = startupWhatsappWarnings({});
    expect(lines[0]).toContain("não definido");
    expect(lines.length).toBeGreaterThan(2);
  });

  it("mensagens de log não citam número de PR (depois do merge isso não diz nada ao operador)", () => {
    const lines = [...whatsappConfigProblems({}), ...whatsappConfigProblems({ WHATSAPP_ACCESS_TOKEN: "x" })].join("\n");
    expect(lines).not.toMatch(/PR #\d+/);
    expect(lines).toContain("fail closed");
  });
});
