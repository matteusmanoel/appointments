/**
 * CLI do simulador do agente WhatsApp.
 * Fala com o mesmo runAgent, no Postgres local, sem WhatsApp e sem ngrok.
 *
 *   npm run simulate:agent -- --tenant <slug|uuid> --replay examples/cavalier-proximo-horario.json
 *   npm run simulate:agent -- --tenant <slug|uuid> --interactive --now 2026-11-14T18:08:00-03:00
 */
import { runSimulator } from "../ai/simulator/session.js";

function usage(): string {
  return `Uso:
  npm run simulate:agent -- --tenant <slug|uuid> --replay <arquivo.json|yaml>
  npm run simulate:agent -- --tenant <slug|uuid> --interactive

Opções:
  --tenant, -t     Slug ou UUID da barbearia
  --phone, -p      Telefone fictício (padrão 5500000000001)
  --now            Relógio simulado (ISO ou '2026-11-14 18:08', fuso America/Sao_Paulo)
  --replay, -r     Arquivo de conversa (JSON ou YAML)
  --interactive, -i
  --llm none|openai   Padrão: none (sem custo de API). openai só interpreta se o turno cair no modelo.
  --trace / --no-trace   Grava trace no Postgres local (flag AI_SIMULATOR_TRACE_ENABLED; padrão no CLI: ligado)

Nada é enviado pelo WhatsApp (provider noop). Não use este comando contra clientes reais.
A tabela de trace só é escrita com a flag ligada (desligada por padrão na API/produção).`;
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
  const llmRaw = (arg(args, ["--llm"]) ?? "none").toLowerCase();
  const llm = llmRaw === "openai" ? "openai" : "none";
  try {
    await runSimulator({
      tenant,
      phone: arg(args, ["--phone", "-p"]),
      now: arg(args, ["--now"]),
      replayPath: arg(args, ["--replay", "-r"]),
      interactive: has(args, ["--interactive", "-i"]),
      llm,
      trace: has(args, ["--no-trace"]) ? false : true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}

main();
