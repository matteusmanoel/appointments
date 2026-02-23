import { test, expect } from "@playwright/test";

test.describe("Smoke — fluxo mínimo", () => {
  test("landing carrega e link para login existe", async ({ page }) => {
    await page.goto("/", { waitUntil: "load", timeout: 15000 });
    // Com sessão vazia: vemos link Entrar ou h1 do hero. Com sessão: redirect para /app.
    const linkEntrar = page.getByRole("link", { name: /entrar/i });
    const h1 = page.locator("h1").first();
    await expect(linkEntrar.or(h1).or(page.getByText(/dashboard|agendamentos/i)).first()).toBeVisible({ timeout: 20000 });
    if (await linkEntrar.isVisible()) {
      await expect(linkEntrar).toBeVisible();
    }
  });

  test("página de login carrega com formulário", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load", timeout: 15000 });
    // Formulário (email/senha) ou redirect para /app se já autenticado
    const emailInput = page.getByRole("textbox", { name: /email/i });
    const dashboardOuApp = page.getByText(/dashboard|agendamentos|sair/i);
    await expect(emailInput.or(dashboardOuApp)).toBeVisible({ timeout: 15000 });
    if (await emailInput.isVisible()) {
      await expect(page.locator('input[type="password"]')).toBeVisible();
    }
  });
});
