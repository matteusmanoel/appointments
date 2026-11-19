import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkContracts,
  createGoldenFixture,
  dbAvailable,
  deleteGoldenFixture,
  runGoldenTurn,
  type GoldenFixture,
} from "./runner.js";
import { REAL_CONVERSATION_CASES } from "./real-conversations.js";

for (const scenario of REAL_CONVERSATION_CASES) {
  describe(`conversa real, linha ${scenario.line}: ${scenario.id}`, () => {
    let ok = false;
    let fx: GoldenFixture | null = null;

    beforeAll(async () => {
      ok = await dbAvailable();
      if (!ok) return;
      fx = await createGoldenFixture(scenario.id, scenario.client);
      if (scenario.prepare) await scenario.prepare(fx);
    });

    afterAll(async () => {
      if (fx) await deleteGoldenFixture(fx);
    });

    const run = scenario.knownGap ? it.fails : it;
    run(scenario.knownGap ?? "cumpre o contrato de cada turno", async () => {
      if (!ok || !fx) throw new Error("Postgres 127.0.0.1:55432 indisponível");
      for (const [index, turn] of scenario.turns.entries()) {
        const outcome = await runGoldenTurn(fx, turn);
        expect({ turn: index + 1, failures: checkContracts(outcome, turn.contracts(fx)) }).toEqual({
          turn: index + 1,
          failures: [],
        });
      }
    }, 60_000);
  });
}
