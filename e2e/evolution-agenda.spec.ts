import { test, expect, type Page } from "@playwright/test";

const PROFILE = {
  id: "e2e-profile",
  email: "e2e@navalhia.test",
  full_name: "E2E",
  barbershop_id: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  billing_plan: "pro",
};

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function mockAuthedApi(page: Page, opts: { connecting?: boolean; withFeed?: boolean } = {}) {
  let connecting = opts.connecting ?? false;
  await page.addInitScript(() => {
    localStorage.setItem("token", "e2e-token");
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/api/auth/me")) {
      await route.fulfill({ json: PROFILE });
      return;
    }
    if (url.includes("/api/reports/agenda-activity")) {
      await route.fulfill({
        json: {
          events: opts.withFeed
            ? [
                {
                  id: "act-1",
                  type: "appointment_created",
                  actor: "ai",
                  client_name: "João",
                  scheduled_date: "2026-09-20",
                  scheduled_time: "14:00:00",
                  summary: null,
                  created_at: new Date().toISOString(),
                  conversation_id: null,
                },
              ]
            : [],
        },
      });
      return;
    }
    if (url.includes("/api/integrations/whatsapp/connect") && method === "POST") {
      connecting = true;
      await route.fulfill({
        json: { status: "connecting", qr: PIXEL, pairingCode: "12345678" },
      });
      return;
    }
    if (url.includes("/api/integrations/whatsapp/status")) {
      await route.fulfill({
        json: connecting
          ? { status: "connecting", connected: false, qr: PIXEL, pairingCode: "12345678" }
          : { status: "disconnected", connected: false },
      });
      return;
    }
    if (url.match(/\/api\/integrations\/whatsapp\/?(\?|$)/) && method === "GET") {
      await route.fulfill({
        json: connecting
          ? { connected: false, status: "connecting", provider: "evolution" }
          : { connected: false, status: "disconnected", provider: "evolution" },
      });
      return;
    }
    if (url.includes("/api/barbershops") && !url.includes("barbers")) {
      await route.fulfill({
        json: {
          id: PROFILE.barbershop_id,
          name: "NavalhIA E2E",
          business_hours: { monday: { start: "09:00", end: "18:00" } },
        },
      });
      return;
    }
    if (method === "GET" && /\/api\/(appointments|barbers|services)\b/.test(url)) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });
}

test.describe("Evolution + agenda feed", () => {
  test("dashboard mostra evento após create da tool", async ({ page }) => {
    await mockAuthedApi(page, { withFeed: true });
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Atividade da agenda")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/João agendou/)).toBeVisible();
  });

  test("stepper QR mockado no connect", async ({ page }) => {
    await mockAuthedApi(page);
    await page.goto("/app/integracoes?step=connect", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Conectar WhatsApp").first()).toBeVisible({ timeout: 20000 });
    await page.locator("#accept-policy").check();
    await page.locator("#accept-use").check();
    await page.getByRole("button", { name: /Conectar WhatsApp/i }).click();
    await expect(page.getByAltText(/QR Code para pareamento/i)).toBeVisible({ timeout: 15000 });
  });
});
