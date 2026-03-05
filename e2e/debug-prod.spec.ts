import { test, expect } from "@playwright/test";

test.describe("Debug prod rendering", () => {
  test("root and login render without JS fatal errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const consoleWarns: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const t = msg.text();
        // In CI/locked networks it's common for external resources (Stripe, fonts, analytics)
        // to fail DNS resolution. This should not fail the "React mounted" regression test.
        if (t.includes("net::ERR_NAME_NOT_RESOLVED") || t.includes("Failed to load resource: net::ERR_NAME_NOT_RESOLVED")) {
          return;
        }
        consoleErrors.push(t);
      }
      if (msg.type() === "warning") consoleWarns.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.stack || err.message);
    });

    await page.goto("/", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);
    const rootHtmlLen = (await page.content()).length;
    const rootInner = await page.evaluate(() => {
      const root = document.querySelector("#root");
      return {
        title: document.title,
        rootExists: !!root,
        rootHtmlLen: root?.innerHTML?.length ?? 0,
        bodyTextLen: (document.body?.innerText ?? "").trim().length,
        scripts: Array.from(document.scripts).map((s) => s.src).filter(Boolean),
      };
    });

    await page.goto("/login", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);
    const loginHtmlLen = (await page.content()).length;
    const loginInner = await page.evaluate(() => {
      const root = document.querySelector("#root");
      return {
        title: document.title,
        rootExists: !!root,
        rootHtmlLen: root?.innerHTML?.length ?? 0,
        bodyTextLen: (document.body?.innerText ?? "").trim().length,
        scripts: Array.from(document.scripts).map((s) => s.src).filter(Boolean),
      };
    });

    const diagnostics = [
      `root: htmlLen=${rootHtmlLen} title=${JSON.stringify(rootInner.title)} rootExists=${rootInner.rootExists} rootInnerLen=${rootInner.rootHtmlLen} bodyTextLen=${rootInner.bodyTextLen}`,
      `root scripts: ${rootInner.scripts.join(", ") || "-"}`,
      `login: htmlLen=${loginHtmlLen} title=${JSON.stringify(loginInner.title)} rootExists=${loginInner.rootExists} rootInnerLen=${loginInner.rootHtmlLen} bodyTextLen=${loginInner.bodyTextLen}`,
      `login scripts: ${loginInner.scripts.join(", ") || "-"}`,
      `pageErrors:\n${pageErrors.join("\n") || "-"}`,
      `consoleErrors:\n${consoleErrors.join("\n") || "-"}`,
      `consoleWarns:\n${consoleWarns.join("\n") || "-"}`,
    ].join("\n");

    // Fail fast if React didn't mount at all.
    if (rootInner.rootHtmlLen === 0 || loginInner.rootHtmlLen === 0) {
      throw new Error(`React did not mount.\n\n${diagnostics}`);
    }

    // If mounted, still fail if there are JS errors.
    if (pageErrors.length || consoleErrors.length) throw new Error(diagnostics);

    expect(rootInner.bodyTextLen).toBeGreaterThan(10);
    expect(loginInner.bodyTextLen).toBeGreaterThan(10);
  });
});

