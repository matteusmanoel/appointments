/**
 * Golden scenarios (Layer 2). Each Turn runs runAgent() against a real Postgres
 * fixture with a scripted OpenAI; contracts assert on turnTrace/state only.
 * Runner: src/ai/simulator/golden/runner.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  checkContracts,
  createGoldenFixture,
  dbAvailable,
  deleteGoldenFixture,
  runGoldenTurn,
  type GoldenFixture,
} from "../ai/simulator/golden/runner.js";

import { SCENARIOS } from "../ai/simulator/golden/scenarios.js";


for (const scenario of SCENARIOS) {
  describe(`golden: ${scenario.id}`, () => {
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

    it("honors every turn contract", async () => {
      if (!ok || !fx) {
        throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
      }
      for (const [index, turn] of scenario.turns.entries()) {
        const outcome = await runGoldenTurn(fx, turn);
        const failures = checkContracts(outcome, turn.contracts(fx));
        expect({ turn: index + 1, user: turn.user, failures }).toEqual({
          turn: index + 1,
          user: turn.user,
          failures: [],
        });
      }
    }, 60_000);
  });
}
