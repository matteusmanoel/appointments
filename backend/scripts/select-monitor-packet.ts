import "../src/load-env.js";
/**
 * Monta o pacote que o monitor lê.
 *
 * npx tsx scripts/select-monitor-packet.ts --log /caminho/worker.log
 * npx tsx scripts/select-monitor-packet.ts --log /caminho/worker.log --persist
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { goldenScenarios } from "../benchmark/scenarios/barbershop/golden.js";
import { insertTurnSheet } from "../src/ai/turn-sheet-store.js";
import { parseWorkerTraceLines } from "../src/ai/turn-sheet.js";
import { attachLabContext, monitorSheetFromRow, selectMonitorPacket } from "../src/ai/monitor-packet.js";
import type { LabScenario } from "../src/ai/monitor-packet.js";
import { pool } from "../src/db.js";

type ReportTurn = { user?: string };
type ReportRow = { id?: string; startedAt?: string; turns?: ReportTurn[] };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function labFromReport(file: string): LabScenario[] {
  const rows = JSON.parse(readFileSync(file, "utf8")) as ReportRow[];
  return rows.flatMap((row) => {
    if (!row.id || !row.startedAt) return [];
    const scenario = goldenScenarios.find((item) => item.id === row.id);
    return [
      {
        id: row.id,
        startedAt: row.startedAt,
        turns: (row.turns ?? [])
          .filter((turn) => turn.user)
          .map((turn) => ({ user: turn.user ?? "", reply: (turn as { reply?: string }).reply ?? "" })),
        priorState: scenario?.golden?.priorState ?? null,
        simulatedNow: scenario?.simulatedNow ?? null,
      },
    ];
  });
}

async function main(): Promise<void> {
  const logPath = arg("--log");
  const reportPath =
    arg("--report") ?? path.resolve(process.cwd(), ".lab/golden-whatsapp-report.json");
  const outPath = arg("--out") ?? path.resolve(process.cwd(), ".lab/monitor-packet.json");
  const persist = process.argv.includes("--persist");
  if (!logPath) throw new Error("informe --log com o stdout do worker");

  const parsed = parseWorkerTraceLines(readFileSync(logPath, "utf8"));
  if (persist) {
    for (const row of parsed) {
      await insertTurnSheet(row);
    }
  }
  const lab = labFromReport(reportPath);
  const sheets = attachLabContext(parsed.map(monitorSheetFromRow), lab);
  const packet = selectMonitorPacket(sheets);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(packet, null, 2));
  console.log(
    `fichas ${parsed.length} grupos ${packet.groupCount} omitidos ${packet.omittedGroups} persist ${persist ? "sim" : "não"}`,
  );
  console.log(outPath);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => {});
  process.exit(1);
});
