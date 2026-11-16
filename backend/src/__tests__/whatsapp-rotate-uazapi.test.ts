import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { decrypt } from "../integrations/encryption.js";
import { rotateUazapiInstance } from "../integrations/whatsapp/rotate-uazapi.js";

const ENC_KEY = "0123456789abcdef0123456789abcdef";
const INSTANCE_TOKEN = "tok-rotate-teste-local";
const WEBHOOK_SECRET = "segredo-de-teste-webhook";
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: string };

function fakeFetch(calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const url = String(input);
    if (url.endsWith("/instance/status")) {
      return new Response(
        JSON.stringify({ instance: { status: "connected", name: "lab-1", id: "inst-9" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/webhook") && (init?.method ?? "GET") === "POST") {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/whatsapp-rotate-uazapi.ts", ...args], {
      cwd: backendRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("whatsapp:rotate com fetch fake", () => {
  const shopIds: string[] = [];
  const envBackup = {
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    WHATSAPP_WEBHOOK_SECRET: process.env.WHATSAPP_WEBHOOK_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  afterEach(async () => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (!shopIds.length) return;
    // Não apaga a barbearia: outros testes pegam a mais antiga de barbershops
    // e quebram se ela sumir no meio da suíte.
    await pool.query(`DELETE FROM public.barbershop_whatsapp_connections WHERE barbershop_id = ANY($1::uuid[])`, [shopIds]);
    shopIds.length = 0;
  });

  it("grava token criptografado, status connected e registra POST /webhook", async () => {
    process.env.APP_ENCRYPTION_KEY = ENC_KEY;
    process.env.WHATSAPP_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const slug = `rotate-${Date.now().toString(36)}`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ($1, '5511999990000', 'pro', $2, '{"monday":{"start":"09:00","end":"19:00"}}'::jsonb)
       RETURNING id`,
      [`Rotate ${slug}`, slug],
    );
    shopIds.push(shop.rows[0].id);

    const calls: FetchCall[] = [];
    const lines: string[] = [];
    const result = await rotateUazapiInstance({
      tenant: slug,
      uazapiUrl: "http://uazapi.test",
      token: INSTANCE_TOKEN,
      webhookUrl: "http://127.0.0.1:3000/api/webhooks/uazapi",
      fetchImpl: fakeFetch(calls),
      print: (line) => lines.push(line),
    });

    expect(result.wroteDatabase).toBe(true);
    expect(result.webhookSet).toBe(true);
    expect(result.instanceState).toBe("connected");
    expect(lines.join("\n")).not.toContain(INSTANCE_TOKEN);
    expect(lines.join("\n")).not.toContain(WEBHOOK_SECRET);

    expect(calls[0]?.url).toBe("http://uazapi.test/instance/status");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.token).toBe(INSTANCE_TOKEN);
    const webhook = calls.find((call) => call.url === "http://uazapi.test/webhook");
    expect(webhook?.method).toBe("POST");
    expect(webhook?.headers.token).toBe(INSTANCE_TOKEN);
    const body = JSON.parse(webhook?.body ?? "{}") as {
      enabled: boolean;
      url: string;
      events: string[];
      excludeMessages: string[];
    };
    expect(body.enabled).toBe(true);
    expect(body.url).toBe(`http://127.0.0.1:3000/api/webhooks/uazapi?token=${WEBHOOK_SECRET}`);
    expect(body.events).toEqual(["messages", "messages_update", "connection"]);
    expect(body.excludeMessages).toEqual(["wasSentByApi"]);

    const row = await pool.query<{
      uazapi_instance_token_encrypted: string;
      uazapi_instance_name: string;
      uazapi_instance_id: string;
      status: string;
      provider: string;
    }>(
      `SELECT provider, uazapi_instance_token_encrypted, uazapi_instance_name, uazapi_instance_id, status
       FROM public.barbershop_whatsapp_connections WHERE barbershop_id = $1`,
      [shop.rows[0].id],
    );
    expect(row.rows[0]?.provider).toBe("uazapi");
    expect(row.rows[0]?.status).toBe("connected");
    expect(row.rows[0]?.uazapi_instance_name).toBe("lab-1");
    expect(row.rows[0]?.uazapi_instance_id).toBe("inst-9");
    expect(row.rows[0]?.uazapi_instance_token_encrypted).not.toContain(INSTANCE_TOKEN);
    expect(decrypt(row.rows[0]!.uazapi_instance_token_encrypted, ENC_KEY)).toBe(INSTANCE_TOKEN);
  });

  it("--dry-run não chama a Uazapi e não grava", async () => {
    const calls: FetchCall[] = [];
    const lines: string[] = [];
    const result = await rotateUazapiInstance({
      tenant: "qualquer",
      uazapiUrl: "http://uazapi.test",
      token: INSTANCE_TOKEN,
      webhookUrl: "http://127.0.0.1:3000/api/webhooks/uazapi",
      dryRun: true,
      fetchImpl: fakeFetch(calls),
      print: (line) => lines.push(line),
    });
    expect(result.wroteDatabase).toBe(false);
    expect(result.webhookSet).toBe(false);
    expect(calls).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/Dry-run/);
    expect(lines.join("\n")).not.toContain(INSTANCE_TOKEN);
  });

  it("--remote só imprime os passos e não grava", async () => {
    const calls: FetchCall[] = [];
    const lines: string[] = [];
    const result = await rotateUazapiInstance({
      tenant: "qualquer",
      uazapiUrl: "http://uazapi.test",
      token: INSTANCE_TOKEN,
      remote: true,
      fetchImpl: fakeFetch(calls),
      print: (line) => lines.push(line),
    });
    expect(result.remote).toBe(true);
    expect(result.wroteDatabase).toBe(false);
    expect(calls).toHaveLength(0);
    const text = lines.join("\n");
    expect(text).toMatch(/UAZAPI_BASE_URL/);
    expect(text).toMatch(/WHATSAPP_PROVIDER/);
    expect(text).toMatch(/barbershop_whatsapp_connections/);
    expect(text).not.toContain(INSTANCE_TOKEN);
  });

  it("recusa banco que não é local", async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:secret@db.example.com:5432/navalhia";
    try {
      await expect(
        rotateUazapiInstance({
          tenant: "qualquer",
          uazapiUrl: "http://uazapi.test",
          token: INSTANCE_TOKEN,
        }),
      ).rejects.toThrow(/não é local|recusada/);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it("o CLI --remote sem TTY imprime os passos e não ecoa token", async () => {
    const run = await runCli(["--remote", "--tenant", "lab", "--token", INSTANCE_TOKEN], {});
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/UAZAPI_BASE_URL/);
    expect(run.stdout).not.toContain(INSTANCE_TOKEN);
    expect(run.stderr).not.toContain(INSTANCE_TOKEN);
  });

  it("o CLI --dry-run não grava e o help não anuncia --token", async () => {
    const dry = await runCli(
      ["--dry-run", "--tenant", "lab", "--uazapi-url", "http://uazapi.test", "--token", INSTANCE_TOKEN],
      { DATABASE_URL: process.env.DATABASE_URL },
    );
    expect(dry.code).toBe(0);
    expect(dry.stdout).toMatch(/Dry-run/);
    expect(dry.stdout).not.toContain(INSTANCE_TOKEN);
    const help = await runCli(["--help"], {});
    expect(help.code).toBe(0);
    expect(help.stdout).not.toMatch(/--token/);
    expect(help.stdout).toMatch(/sem eco/);
  });

  it("o CLI recusa DATABASE_URL remota sem --remote", async () => {
    const run = await runCli(["--dry-run", "--tenant", "lab", "--uazapi-url", "http://uazapi.test", "--token", INSTANCE_TOKEN], {
      DATABASE_URL: "postgres://user:secret@db.example.com:5432/navalhia",
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/recusada|não é local/);
    expect(run.stderr).not.toContain("db.example.com");
    expect(run.stderr).not.toContain(INSTANCE_TOKEN);
    expect(run.stdout).not.toContain(INSTANCE_TOKEN);
  });
});
