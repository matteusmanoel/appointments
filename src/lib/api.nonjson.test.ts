import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api(): resposta que não é JSON", () => {
  afterEach(() => vi.restoreAllMocks());

  it("200 com HTML (rewrite do SPA sem backend) vira erro claro, não {}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })));
    await expect(api("/api/public/x/barbers")).rejects.toThrow(/não respondeu como esperado/);
  });

  it("200 com JSON continua funcionando", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: "1" }]), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(api("/api/public/x/barbers")).resolves.toEqual([{ id: "1" }]);
  });

  it("erro da API traz a mensagem em pt-BR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Só é possível cancelar até 2 horas antes do horário" }), { status: 400 })));
    await expect(api("/api/x", { method: "POST" })).rejects.toThrow(/2 horas/);
  });

  it("204 retorna undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api("/api/x", { method: "POST" })).resolves.toBeUndefined();
  });
});
