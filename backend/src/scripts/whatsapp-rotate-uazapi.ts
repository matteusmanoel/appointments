/**
 * Troca a instância Uazapi de um tenant.
 *
 *   npm run whatsapp:rotate -- --tenant <slug> --webhook-url https://<publico>/api/webhooks/uazapi
 *
 * Pede a URL do servidor e o token no terminal, sem eco. Não lê nem edita .env.
 * Guarda de banco local. --remote só imprime os passos da AWS. --dry-run não grava.
 */
import { emitKeypressEvents } from "node:readline";
import { rotateUazapiInstance, remoteRotateSteps, sanitizePublicUrl } from "../integrations/whatsapp/rotate-uazapi.js";
import { assertLocalDatabaseUrl } from "../db/local-database-url.js";

function usage(): string {
  return `Uso:
  npm run whatsapp:rotate -- --tenant <slug|uuid> [--webhook-url https://<publico>/api/webhooks/uazapi]
                             [--dry-run] [--remote]

O comando pede a URL do servidor Uazapi e o token da instância (sem eco).
Não imprime token, URL com credenciais ou headers. Não edita o .env.

  --tenant, -t     Slug ou UUID da barbearia
  --webhook-url    URL pública do backend (…/api/webhooks/uazapi)
  --instance-name  Nome da instância, se a API de status não trouxer
  --dry-run        Não grava no banco e não chama a Uazapi
  --remote         Só imprime os passos para a AWS; não grava nada
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
    throw new Error("Este terminal não aceita digitação oculta. Rode em um TTY, ou use o modo de testes.");
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

async function main() {
  const args = process.argv.slice(2);
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
  if (!remote) {
    try {
      assertLocalDatabaseUrl();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`${msg}\nUse --remote para só imprimir os passos da AWS.\n`);
      process.exit(1);
    }
  } else if (dryRun || true) {
    // --remote não pede token se o operador só quer os passos; ainda assim pedimos se quiserem o texto completo.
  }

  if (remote && !arg(args, ["--uazapi-url"]) && !process.stdin.isTTY) {
    for (const line of remoteRotateSteps({ webhookUrl: arg(args, ["--webhook-url"]) })) {
      process.stdout.write(`${line}\n`);
    }
    return;
  }

  const uazapiUrl = (arg(args, ["--uazapi-url"]) ?? (await promptHidden("URL do servidor Uazapi (sem eco): "))).trim();
  const token = (arg(args, ["--token"]) ?? (await promptHidden("Token da instância (sem eco): "))).trim();
  // --token / --uazapi-url existem só para testes internos; o help não os anuncia para não incentivar token na linha de comando.
  try {
    await rotateUazapiInstance({
      tenant,
      uazapiUrl,
      token,
      instanceName: arg(args, ["--instance-name"]),
      webhookUrl: arg(args, ["--webhook-url"]),
      dryRun,
      remote,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${sanitizePublicUrl(msg) === msg ? msg : "Falha ao trocar a instância."}\n`);
    process.exit(1);
  }
}

main();
