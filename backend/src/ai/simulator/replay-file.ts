import { readFileSync } from "node:fs";
import { parseSimulatedNow } from "./clock.js";

export type ReplayTurn = {
  role: "user" | "assistant";
  text: string;
};

export type ReplayScript = {
  tenant?: string;
  phone?: string;
  now?: string;
  turns: ReplayTurn[];
};

export function parseReplayFile(path: string): ReplayScript {
  const raw = readFileSync(path, "utf8");
  const lower = path.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return normalizeScript(parseSimpleYaml(raw), path);
  }
  try {
    return normalizeScript(JSON.parse(raw), path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Arquivo de replay inválido (${path}): ${msg}`);
  }
}

function normalizeScript(raw: unknown, path: string): ReplayScript {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Replay ${path} deve ser um objeto com a lista "turns".`);
  }
  const r = raw as Record<string, unknown>;
  const turnsRaw = Array.isArray(r.turns) ? r.turns : Array.isArray(r) ? r : null;
  if (!turnsRaw) throw new Error(`Replay ${path} precisa de "turns".`);
  const turns: ReplayTurn[] = turnsRaw.map((item, i) => {
    if (typeof item === "string") return { role: "user", text: item };
    if (!item || typeof item !== "object") {
      throw new Error(`Turno ${i + 1} inválido em ${path}.`);
    }
    const t = item as Record<string, unknown>;
    const text = String(t.text ?? t.user ?? t.content ?? "").trim();
    if (!text) throw new Error(`Turno ${i + 1} sem texto em ${path}.`);
    const roleRaw = String(t.role ?? (t.user || t.assistant == null ? "user" : "assistant")).toLowerCase();
    const role: "user" | "assistant" = roleRaw === "assistant" ? "assistant" : "user";
    return { role, text };
  });
  if (!turns.length) throw new Error(`Replay ${path} não tem turnos.`);
  const now = typeof r.now === "string" ? r.now : typeof r.simulatedNow === "string" ? r.simulatedNow : undefined;
  if (now && !parseSimulatedNow(now)) {
    throw new Error(`Replay ${path}: "now" inválido (${now}). Use ISO, ex. 2026-11-14T18:08:00-03:00.`);
  }
  return {
    tenant: typeof r.tenant === "string" ? r.tenant : undefined,
    phone: typeof r.phone === "string" ? r.phone : undefined,
    now,
    turns,
  };
}

/**
 * YAML mínimo para o formato do simulador (chaves planas + lista de turnos).
 * Não é um parser YAML genérico.
 */
export function parseSimpleYaml(source: string): unknown {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  const root: Record<string, unknown> = {};
  let turns: unknown[] | null = null;
  let current: Record<string, unknown> | null = null;

  const unquote = (v: string) => {
    const s = v.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const turnsMatch = line.match(/^turns:\s*$/);
    if (turnsMatch) {
      turns = [];
      root.turns = turns;
      current = null;
      continue;
    }
    const itemKey = line.match(/^\s*-\s+(?:(user|assistant|role|text|content):\s*)?(.*)$/);
    if (itemKey && turns) {
      const key = itemKey[1];
      const rest = unquote(itemKey[2] ?? "");
      if (!key || key === "user") {
        current = { role: "user", text: rest };
        turns.push(current);
      } else if (key === "assistant") {
        current = { role: "assistant", text: rest };
        turns.push(current);
      } else if (key === "role") {
        current = { role: rest };
        turns.push(current);
      } else {
        current = { [key]: rest };
        turns.push(current);
      }
      continue;
    }
    const nested = line.match(/^\s{2,}(user|assistant|role|text|content):\s*(.*)$/);
    if (nested && current) {
      const key = nested[1];
      const val = unquote(nested[2] ?? "");
      if (key === "user" || key === "assistant") {
        current.role = key;
        current.text = val;
      } else {
        current[key] = val;
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (kv && !line.startsWith(" ") && !line.startsWith("\t")) {
      const val = unquote(kv[2] ?? "");
      if (val !== "") root[kv[1]] = val;
      continue;
    }
  }
  return root;
}
