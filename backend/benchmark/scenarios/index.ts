import { greetingScenarios } from "./barbershop/greeting.js";
import { bookingScenarios } from "./barbershop/booking.js";
import { rescheduleScenarios } from "./barbershop/reschedule.js";
import { cancellationScenarios } from "./barbershop/cancellation.js";
import { managementScenarios } from "./barbershop/management.js";
import { memoryScenarios } from "./barbershop/memory.js";
import { edgeCaseScenarios } from "./barbershop/edge-cases.js";
import { planScenarios } from "./barbershop/plans.js";
import type { Scenario, ScenarioTag } from "../types.js";

/** Complete scenario registry */
export const ALL_SCENARIOS: Scenario[] = [
  ...greetingScenarios,
  ...bookingScenarios,
  ...rescheduleScenarios,
  ...cancellationScenarios,
  ...managementScenarios,
  ...memoryScenarios,
  ...edgeCaseScenarios,
  ...planScenarios,
];

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
