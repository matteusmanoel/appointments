import { test, expect } from "@playwright/test";

/**
 * Páginas públicas sem backend (como o preview da Vercel: `/api/*` devolve o index.html com 200).
 * Não precisa de API, conta nem envio de formulário. Cobre o B1 do ui-blockers (tela de erro, sem skeleton infinito).
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
});

test("/b/:slug sem backend termina em «Barbearia não encontrada.» (sem skeleton infinito)", async ({ page }) => {
  await page.goto("/b/minha-barbearia");
  await expect(page.getByText("Barbearia não encontrada.")).toBeVisible({ timeout: 15_000 });
});

test("/reagendar/:token sem backend mostra erro de carregamento com «Tentar de novo» (não diz que foi cancelado)", async ({ page }) => {
  await page.goto("/reagendar/abc");
  await expect(page.getByText(/Não conseguimos carregar o seu agendamento/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(page.getByText(/já cancelado/)).toHaveCount(0);
});
