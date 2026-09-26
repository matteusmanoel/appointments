import { goldenScenarios } from "./barbershop/golden.js";
import type { Scenario, ScenarioTag } from "../types.js";

/**
 * Suíte ativa: só os golden scenarios da revisão de 24/09.
 * Os arquivos antigos (greeting, booking, memory, edge, …) continuam no disco
 * e ficam de fora do runner até a revisão humana desta lista.
 */
export const ALL_SCENARIOS: Scenario[] = [...goldenScenarios];

/**
 * Filter scenarios by one or more tags.
 * An empty tags array returns all scenarios.
 */
export function filterScenarios(tags: ScenarioTag[]): Scenario[] {
  if (tags.length === 0) return ALL_SCENARIOS;
  return ALL_SCENARIOS.filter((s) => s.tags.some((t) => tags.includes(t)));
}

/**
 * Get a single scenario by ID. Throws if not found.
 */
export function getScenario(id: string): Scenario {
  const s = ALL_SCENARIOS.find((sc) => sc.id === id);
  if (!s) throw new Error(`Scenario not found: ${id}`);
  return s;
}

/** All unique tags in the registry */
export const ALL_TAGS: ScenarioTag[] = [
  ...new Set(ALL_SCENARIOS.flatMap((s) => s.tags)),
];
