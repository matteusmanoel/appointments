import type { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";
import { isValidUuid } from "./uuid.js";

/**
 * Isolamento por tenant para ids referenciados em body/query.
 * Toda referência (cliente, barbeiro, serviço, plano, fonte de conhecimento…) precisa pertencer ao
 * barbershop_id do JWT (ou da chave de /tools). Id inexistente e id de outro tenant dão a MESMA resposta (404),
 * para não revelar a existência de dados alheios.
 */
export type TenantRefs = {
  clients?: Array<string | null | undefined>;
  barbers?: Array<string | null | undefined>;
  services?: Array<string | null | undefined>;
  plans?: Array<string | null | undefined>;
  knowledgeSources?: Array<string | null | undefined>;
  messageTemplates?: Array<string | null | undefined>;
};

type Kind = keyof TenantRefs;

const TABLES: Record<Kind, { table: string; label: string }> = {
  clients: { table: "public.clients", label: "Cliente" },
  barbers: { table: "public.barbers", label: "Barbeiro" },
  services: { table: "public.services", label: "Serviço" },
  plans: { table: "public.barbershop_plans", label: "Plano" },
  knowledgeSources: { table: "public.barbershop_ai_knowledge_sources", label: "Fonte de conhecimento" },
  messageTemplates: { table: "public.message_templates", label: "Modelo de mensagem" },
};

export type ForeignRef = { kind: Kind; label: string; ids: string[] };

/** Devolve as referências que NÃO pertencem ao(s) tenant(s) informado(s) (inclui ids malformados). */
export async function findForeignRefs(scope: string | string[], refs: TenantRefs): Promise<ForeignRef[]> {
  const shops = Array.isArray(scope) ? scope : [scope];
  const out: ForeignRef[] = [];
  for (const kind of Object.keys(refs) as Kind[]) {
    const wanted = [...new Set((refs[kind] ?? []).filter((v): v is string => typeof v === "string" && v !== ""))];
    if (wanted.length === 0) continue;
    const malformed = wanted.filter((id) => !isValidUuid(id));
    const valid = wanted.filter((id) => isValidUuid(id));
    let missing = malformed;
    if (valid.length > 0) {
      const { table } = TABLES[kind];
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) AND barbershop_id = ANY($2::uuid[])`,
        [valid, shops],
      );
      const found = new Set(r.rows.map((x) => x.id));
      missing = missing.concat(valid.filter((id) => !found.has(id)));
    }
    if (missing.length > 0) out.push({ kind, label: TABLES[kind].label, ids: missing });
  }
  return out;
}

/** Responde 404 e devolve false se alguma referência não for do tenant. */
export async function requireTenantRefs(res: Response, scope: string | string[], refs: TenantRefs): Promise<boolean> {
  const foreign = await findForeignRefs(scope, refs);
  if (foreign.length === 0) return true;
  const first = foreign[0]!;
  res.status(404).json({
    error: `${first.label}${first.ids.length > 1 ? "s" : ""} não encontrado${first.ids.length > 1 ? "s" : ""}`,
    ids: first.ids,
  });
  return false;
}

/** `router.param("id", uuidParam)`: id de rota malformado vira 404 (antes: erro do Postgres → 500). */
export function uuidParam(req: Request, res: Response, next: NextFunction, value: string): void {
  if (!isValidUuid(value)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}
