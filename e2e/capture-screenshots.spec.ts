import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");

test.describe("Capture landing screenshots", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  });

  test("capture dashboard screenshot", async ({ page }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
    await page.goto(`${baseURL}/login`, { waitUntil: "networkidle", timeout: 15000 });
    await page.getByRole("textbox", { name: /email/i }).fill("admin@navalhia.com.br");
    await page.locator('input[type="password"]').fill("admin123");
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
