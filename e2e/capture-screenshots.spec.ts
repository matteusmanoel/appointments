import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");

test.describe("Capture landing screenshots", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  });

  test("capture dashboard screenshot", async ({ page }) => {
    test.skip(process.env.E2E_DASHBOARD_EMAIL == null || process.env.E2E_DASHBOARD_PASSWORD == null, "Requer E2E_DASHBOARD_EMAIL e E2E_DASHBOARD_PASSWORD.");
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
    await page.goto(`${baseURL}/login`, { waitUntil: "networkidle", timeout: 15000 });
    await page.getByRole("textbox", { name: /email/i }).fill(process.env.E2E_DASHBOARD_EMAIL!);
    await page.locator('input[type="password"]').fill(process.env.E2E_DASHBOARD_PASSWORD!);
    await page.getByRole("button", { name: /entrar|login/i }).click();
    await expect(page).toHaveURL(/\/(app|dashboard)/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "dashboard.png"),
      fullPage: true,
    });
  });

  test("capture whatsapp-demo screenshot", async ({ page }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
    await page.goto(baseURL + "/", { waitUntil: "networkidle", timeout: 15000 });
    await page.getByRole("button", { name: /testar demo agora/i }).first().click();
    await page.waitForSelector("[role='dialog']", { timeout: 8000 });
    await page.waitForTimeout(600);
    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: path.join(SCREENSHOTS_DIR, "whatsapp-demo.png") });
  });
});
