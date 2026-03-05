import { test, expect } from "@playwright/test";

/**
 * Garante que a rota de checkout da API existe (não 404).
 * Envia body vazio para não gerar cobrança; espera 400/422 (validação), nunca 404.
 */
function getApiBase(): string {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
  if (base.includes("app.navalhia.com.br")) return "https://api.navalhia.com.br";
  if (base.includes("localhost:3002")) return "http://localhost:3003";
  return process.env.E2E_API_URL ?? "http://localhost:3003";
}

test.describe("Checkout route (API)", () => {
  test("POST /api/billing/checkout exists and returns validation error for empty body (not 404)", async ({ request }) => {
    test.skip(process.env.E2E_API_URL == null && !(process.env.PLAYWRIGHT_BASE_URL ?? "").includes("app.navalhia.com.br"), "Requer API rodando em localhost:3003 ou E2E_API_URL configurada.");
    const apiBase = getApiBase();
    const res = await request.post(`${apiBase}/api/billing/checkout`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect(res.status(), "Checkout route must not be 404").not.toBe(404);
    expect([400, 422]).toContain(res.status());
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty("error");
  });
});
