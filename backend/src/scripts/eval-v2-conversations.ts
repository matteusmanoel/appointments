/**
 * Roda as conversas reais no motor novo, com a OpenAI de verdade e o Postgres local.
 *   npm run eval:v2
 * Recusa banco remoto e não envia mensagens pelo WhatsApp.
 */
import "../load-env.js";
import OpenAI from "openai";
import { pool } from "../db.js";
import { assertLocalDatabaseUrl } from "../db/local-database-url.js";
import { runAgentV2 } from "../ai/agent/v2/engine.js";
import { REAL_CONVERSATION_CASES } from "../ai/simulator/golden/real-conversations.js";
import {
  checkContracts,
  createGoldenFixture,
  deleteGoldenFixture,
  runGoldenTurn,
  type Contract,
} from "../ai/simulator/golden/runner.js";

/** Estes contratos descrevem o rascunho e as rodadas de ferramentas do motor antigo. */
const LEGACY_ONLY = new Set<Contract["kind"]>([
  "draft_status",
  "draft_service_ids",
  "draft_barber_id",
  "draft_last_question",
  "draft_proposal_service_ids",
  "draft_usual_suggested",
  "draft_time_not",
  "openai_rounds",
  "tools_executed",
]);

async function main(): Promise<void> {
  assertLocalDatabaseUrl();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY não definida.");
  const openai = new OpenAI({ apiKey });
  let passed = 0;
  for (const scenario of REAL_CONVERSATION_CASES) {
    const fx = await createGoldenFixture(scenario.id, scenario.client);
    const failures: string[] = [];
    const replies: string[] = [];
    try {
      if (scenario.prepare) await scenario.prepare(fx);
      for (const turn of scenario.turns) {
        const outcome = await runGoldenTurn(fx, turn, () =>
          runAgentV2(fx.barbershopId, fx.conversationId, fx.clientPhone, openai, { polish: false }),
        );
        replies.push(outcome.result.reply);
        failures.push(...checkContracts(outcome, turn.contracts(fx).filter((contract) => !LEGACY_ONLY.has(contract.kind))));
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    } finally {
      await deleteGoldenFixture(fx);
    }
    if (failures.length === 0) passed += 1;
    console.log(`${failures.length ? "FALHOU" : "OK    "} linha ${scenario.line} ${scenario.id}`);
    for (const failure of failures) console.log(`   ${failure.slice(0, 220)}`);
    if (failures.length) console.log(`   resposta: ${replies.join(" || ").slice(0, 260)}`);
  }
  console.log(`\n${passed}/${REAL_CONVERSATION_CASES.length} conversas reais aprovadas`);
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
