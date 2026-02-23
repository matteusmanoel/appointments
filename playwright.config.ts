import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke E2E: rode com o app em execução (npm run dev ou npm run preview).
 * Ex.: npm run build && npm run preview & npx playwright test
 * Ou: npm run dev (em outro terminal) e npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.CI
    ? {
        command: "npm run build && npx vite preview --port 3002",
        url: "http://localhost:3002",
        reuseExistingServer: false,
        timeout: 120000,
      }
    : undefined,
});
