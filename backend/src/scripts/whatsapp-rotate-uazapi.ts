/**
 * Troca a instância Uazapi de um tenant.
 *
 *   npm run whatsapp:rotate -- --tenant <slug> --webhook-url https://<publico>/api/webhooks/uazapi
 *
 * URL e token vêm do prompt sem eco, ou de UAZAPI_BASE_URL e UAZAPI_NEW_TOKEN.
 * Não lê nem edita .env. Guarda de banco local. --remote só imprime os passos da AWS.
 */
import { emitKeypressEvents } from "node:readline";
import { rotateUazapiInstance, remoteRotateSteps, sanitizePublicUrl } from "../integrations/whatsapp/rotate-uazapi.js";
import { assertLocalDatabaseUrl } from "../db/local-database-url.js";
import { redactWebhookSecrets } from "../integrations/whatsapp/webhook-auth.js";

function usage(): string {
  return `Uso:
  npm run whatsapp:rotate -- --tenant <slug|uuid> [--webhook-url https://<publico>/api/webhooks/uazapi]
                             [--dry-run] [--remote] [--allow-http]

A URL do servidor e o token da instância vêm do prompt sem eco, ou das variáveis
UAZAPI_BASE_URL e UAZAPI_NEW_TOKEN. Não coloque esses valores na linha de comando.
Não imprime token, URL com query, headers ou corpo da resposta. Não edita o .env.

  --tenant, -t     Slug ou UUID da barbearia
  --webhook-url    URL pública https do backend (…/api/webhooks/uazapi)
  --instance-name  Nome da instância, se a API de status não trouxer
  --dry-run        Não grava no banco e não chama a Uazapi
  --remote         Só imprime os passos para a AWS; não grava nada e não pede token
  --allow-http     Laboratório: HTTP em localhost e host privado na URL da Uazapi.
                   O webhook continua https e público.
`;
}

function arg(args: string[], names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) return "";
      return next;
    }
    for (const name of names) {
      if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
    }
  }
  return undefined;
}

function has(args: string[], names: string[]): boolean {
  return args.some((a) => names.includes(a));
}

async function promptHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  stdout.write(label);
  if (!stdin.isTTY) {
    throw new Error("Este terminal não aceita digitação oculta. Rode em um TTY, ou defina UAZAPI_BASE_URL e UAZAPI_NEW_TOKEN.");
  }
  emitKeypressEvents(stdin);
  if (stdin.isRaw === false) stdin.setRawMode?.(true);
  stdin.resume();
  let acc = "";
  return new Promise((resolve, reject) => {
    const onKey = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key?.ctrl && key.name === "c") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off("keypress", onKey);
        stdout.write("\n");
        reject(new Error("Cancelado."));
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off("keypress", onKey);
        stdout.write("\n");
        resolve(acc.trim());
        return;
      }
      if (key?.name === "backspace") {
        acc = acc.slice(0, -1);
        return;
      }
      if (str && str.length === 1 && str >= " ") acc += str;
    };
    stdin.on("keypress", onKey);
  });
}

function rejectSecretArgs(args: string[]): void {
  const forbidden = args.some(
    (a) => a === "--token" || a === "--uazapi-url" || a.startsWith("--token=") || a.startsWith("--uazapi-url="),
  );
  if (!forbidden) return;
  process.stderr.write(
    "Não passe o token nem a URL da Uazapi na linha de comando. Use o prompt sem eco, ou as variáveis UAZAPI_NEW_TOKEN e UAZAPI_BASE_URL.\n",
  );
  process.exit(1);
}

function publicFailure(e: unknown, secrets: string[]): string {
  const raw = e instanceof Error ? e.message : String(e);
  let msg = redactWebhookSecrets(raw);
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length < 4) continue;
    msg = msg.split(value).join("[redacted]");
  }
  msg = msg.replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'")\]]+/g, (found) => {
    try {
      return sanitizePublicUrl(found);
    } catch {
      return "[url]";
    }
  });
  msg = msg.replace(/\b(token|authorization|admintoken|apikey|cookie)\b\s*[:=]\s*\S+/gi, "$1=[redacted]");
  return msg;
}

async function main() {
  const args = process.argv.slice(2);
  rejectSecretArgs(args);
  if (has(args, ["-h", "--help"]) || args.length === 0) {
    process.stdout.write(`${usage()}\n`);
    process.exit(args.length === 0 ? 1 : 0);
  }
  const tenant = arg(args, ["--tenant", "-t"]);
  if (!tenant) {
    process.stderr.write("Faltou --tenant.\n\n" + usage() + "\n");
    process.exit(1);
  }
  const remote = has(args, ["--remote"]);
  const dryRun = has(args, ["--dry-run"]);
  if (remote) {
    for (const line of remoteRotateSteps({ webhookUrl: arg(args, ["--webhook-url"]) })) {
      process.stdout.write(`${line}\n`);
    }
    return;
  }
  try {
    assertLocalDatabaseUrl();
  } catch (e) {
    process.stderr.write(`${publicFailure(e, [])}\nUse --remote para só imprimir os passos da AWS.\n`);
    process.exit(1);
  }

  const uazapiUrl = (process.env.UAZAPI_BASE_URL ?? "").trim() || (await promptHidden("URL do servidor Uazapi (sem eco): ")).trim();
  const token = (process.env.UAZAPI_NEW_TOKEN ?? "").trim() || (await promptHidden("Token da instância (sem eco): ")).trim();
  try {
    await rotateUazapiInstance({
      tenant,
      uazapiUrl,
      token,
      instanceName: arg(args, ["--instance-name"]),
      webhookUrl: arg(args, ["--webhook-url"]),
      dryRun,
      remote,
      allowLocal: has(args, ["--allow-http"]),
    });
  } catch (e) {
    const secrets = [token, process.env.UAZAPI_NEW_TOKEN ?? "", process.env.WHATSAPP_WEBHOOK_SECRET ?? ""];
    process.stderr.write(`${publicFailure(e, secrets)}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  const secrets = [process.env.UAZAPI_NEW_TOKEN ?? "", process.env.WHATSAPP_WEBHOOK_SECRET ?? ""];
  process.stderr.write(`${publicFailure(e, secrets)}\n`);
  process.exit(1);
});
