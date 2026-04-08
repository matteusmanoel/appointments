/**
 * benchmark/incidents.ts — query and export ai_incidents from the DB.
 *
 * Usage from CLI:
 *   npx tsx benchmark/cli.ts incidents list
 *   npx tsx benchmark/cli.ts incidents export <id>
 *   npx tsx benchmark/cli.ts incidents list --status open
 *   npx tsx benchmark/cli.ts incidents list --barbershop <uuid>
 */

import { pool } from "../src/db.js";

export interface SavedIncident {
  id: string;
  barbershop_id: string;
  conversation_id: string | null;
  incident_type: string;
  severity: "critical" | "medium" | "light";
  manager_note: string | null;
  transcript_json: Array<{ role: string; content: string }>;
  settings_snapshot_json: Record<string, unknown> | null;
  diagnosis_result_json: Record<string, unknown> | null;
  benchmark_scenario_draft_json: Record<string, unknown> | null;
  status: "open" | "triaged" | "promoted" | "archived";
  created_at: string;
}

export interface IncidentListItem {
  id: string;
  incident_type: string;
  severity: string;
  status: string;
  manager_note: string | null;
  conversation_id: string | null;
  created_at: string;
}

export async function listIncidents(opts?: {
  limit?: number;
  status?: string;
  barbershopId?: string;
}): Promise<IncidentListItem[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.barbershopId) {
    params.push(opts.barbershopId);
    conditions.push(`barbershop_id = $${params.length}`);
  }
  if (opts?.status) {
    params.push(opts.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  params.push(limit);

  const result = await pool.query<IncidentListItem>(
    `SELECT id, incident_type, severity, status, manager_note, conversation_id, created_at
     FROM public.ai_incidents
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function getIncident(id: string): Promise<SavedIncident | null> {
  const result = await pool.query<SavedIncident>(
    `SELECT id, barbershop_id, conversation_id, incident_type, severity, status,
            manager_note, transcript_json, settings_snapshot_json,
            diagnosis_result_json, benchmark_scenario_draft_json, created_at
     FROM public.ai_incidents
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateIncidentStatus(
  id: string,
  status: "open" | "triaged" | "promoted" | "archived"
): Promise<void> {
  await pool.query(
    `UPDATE public.ai_incidents SET status = $1, updated_at = now() WHERE id = $2`,
    [status, id]
  );
}

/** Extract benchmark scenario draft from a saved incident.
 *  Returns the stored draft if present, otherwise returns null. */
export function extractScenarioDraft(incident: SavedIncident): Record<string, unknown> | null {
  return incident.benchmark_scenario_draft_json ?? null;
}
