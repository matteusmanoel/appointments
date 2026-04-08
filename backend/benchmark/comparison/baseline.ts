/**
 * Baseline management — save, load, and tag benchmark run results.
 *
 * Results are stored as JSON files in benchmark/results/.
 * Each file is named: {runId}.json
 * A registry file (results/registry.json) tracks tags and metadata.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { BaselineRecord, BaselineTag, BenchmarkRun } from "../types.js";
import { DEFAULT_CONFIG } from "../config.js";

const REGISTRY_FILENAME = "registry.json";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getResultsDir(configResultsDir?: string): string {
  return configResultsDir ?? DEFAULT_CONFIG.resultsDir;
}

function getResultFilePath(runId: string, resultsDir: string): string {
  return path.join(resultsDir, `${runId}.json`);
}

function getRegistryPath(resultsDir: string): string {
  return path.join(resultsDir, REGISTRY_FILENAME);
}

// ---------------------------------------------------------------------------
// Registry CRUD
// ---------------------------------------------------------------------------

async function loadRegistry(resultsDir: string): Promise<BaselineRecord[]> {
  await ensureDir(resultsDir);
  const registryPath = getRegistryPath(resultsDir);
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(raw) as BaselineRecord[];
  } catch {
    return [];
  }
}

async function saveRegistry(records: BaselineRecord[], resultsDir: string): Promise<void> {
  await ensureDir(resultsDir);
  const registryPath = getRegistryPath(resultsDir);
  await fs.writeFile(registryPath, JSON.stringify(records, null, 2), "utf-8");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a benchmark run to disk and add it to the registry.
 * Returns the file path where it was saved.
 */
export async function saveRun(
  run: BenchmarkRun,
  tag: BaselineTag = "candidate",
  resultsDir?: string
): Promise<string> {
  const dir = getResultsDir(resultsDir);
  await ensureDir(dir);

  const filePath = getResultFilePath(run.meta.runId, dir);
  await fs.writeFile(filePath, JSON.stringify(run, null, 2), "utf-8");

  const records = await loadRegistry(dir);
  const record: BaselineRecord = {
    runId: run.meta.runId,
    tag,
    savedAt: new Date().toISOString(),
    filePath,
    summary: run.summary,
    meta: run.meta,
  };

  // Remove existing record with same runId if any
  const filtered = records.filter((r) => r.runId !== run.meta.runId);
  filtered.push(record);
  await saveRegistry(filtered, dir);

  return filePath;
}

/**
 * Load a run from disk by runId.
 */
export async function loadRun(runId: string, resultsDir?: string): Promise<BenchmarkRun> {
  const dir = getResultsDir(resultsDir);
  const filePath = getResultFilePath(runId, dir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as BenchmarkRun;
  } catch {
    throw new Error(`Run not found: ${runId} (looked at ${filePath})`);
  }
}

/**
 * Load a run from disk by file path.
 */
export async function loadRunFromFile(filePath: string): Promise<BenchmarkRun> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as BenchmarkRun;
}

/**
 * Get the latest run with a specific tag. Returns null if none exists.
 */
export async function getLatestByTag(
  tag: BaselineTag,
  resultsDir?: string
): Promise<BaselineRecord | null> {
  const dir = getResultsDir(resultsDir);
  const records = await loadRegistry(dir);
  const tagged = records.filter((r) => r.tag === tag);
  if (tagged.length === 0) return null;
  return tagged.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
}

/**
 * Promote a run to "production" tag.
 * Archives the previous production run.
 */
export async function promoteToProduction(
  runId: string,
  resultsDir?: string
): Promise<void> {
  const dir = getResultsDir(resultsDir);
  const records = await loadRegistry(dir);

  const updated = records.map((r) => {
    if (r.tag === "production") {
      return { ...r, tag: "archived" as BaselineTag };
    }
    if (r.runId === runId) {
      return { ...r, tag: "production" as BaselineTag };
    }
    return r;
  });

  const found = updated.find((r) => r.runId === runId);
  if (!found) {
    throw new Error(`Run ${runId} not found in registry`);
  }

  await saveRegistry(updated, dir);
}

/**
 * List all registry records, optionally filtered by tag.
 */
export async function listRuns(
  tag?: BaselineTag,
  resultsDir?: string
): Promise<BaselineRecord[]> {
  const dir = getResultsDir(resultsDir);
  const records = await loadRegistry(dir);
  const sorted = records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return tag ? sorted.filter((r) => r.tag === tag) : sorted;
}

/**
 * Delete a run from disk and registry. Use with care.
 */
export async function deleteRun(runId: string, resultsDir?: string): Promise<void> {
  const dir = getResultsDir(resultsDir);
  const records = await loadRegistry(dir);
  const record = records.find((r) => r.runId === runId);

  if (record) {
    try {
      await fs.unlink(record.filePath);
    } catch {
      // File may already be missing
    }
  }

  await saveRegistry(
    records.filter((r) => r.runId !== runId),
    dir
  );
}
