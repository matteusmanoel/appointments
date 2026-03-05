import OpenAI from "openai";
import { pool } from "../db.js";

const RAG_TOP_K = 6;
const RAG_MAX_CHARS = 5000;
/** Cosine distance threshold: only include chunks with distance <= this (0 = identical, 2 = opposite). */
const RAG_MIN_DISTANCE_THRESHOLD = 0.55;

export type RagChunk = {
  content: string;
  docTitle: string;
  sourceName: string | null;
};

/**
 * Retrieve relevant knowledge chunks for a query using the barbershop's knowledge base.
 * Returns at most RAG_MAX_CHARS of concatenated chunk text, only if similarity is above threshold.
 */
export async function retrieveKnowledge(
  barbershopId: string,
  query: string,
  openai: OpenAI
): Promise<RagChunk[] | null> {
  if (!query?.trim()) return null;
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query.trim().slice(0, 8000),
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length !== 1536) return null;

  const vectorStr = `[${embedding.join(",")}]`;
  const r = await pool.query<{
    content: string;
    doc_title: string;
    source_name: string | null;
    distance: number;
  }>(
    `SELECT c.content, d.title AS doc_title, s.name AS source_name,
            (c.embedding <=> $2::vector) AS distance
     FROM public.barbershop_ai_knowledge_chunks c
     JOIN public.barbershop_ai_knowledge_documents d ON d.id = c.document_id AND d.status = 'ready'
     LEFT JOIN public.barbershop_ai_knowledge_sources s ON s.id = d.source_id AND s.enabled = true
     WHERE c.barbershop_id = $1
     ORDER BY c.embedding <=> $2::vector
     LIMIT $3`,
    [barbershopId, vectorStr, RAG_TOP_K]
  );

  const rows = r.rows.filter((row) => row.distance <= RAG_MIN_DISTANCE_THRESHOLD);
  if (rows.length === 0) return null;

  const chunks: RagChunk[] = rows.map((row) => ({
    content: row.content,
    docTitle: row.doc_title,
    sourceName: row.source_name,
  }));
  return chunks;
}

/**
 * Build the "--- Conhecimento ---" block for injection into the system prompt.
 * Truncates to RAG_MAX_CHARS and deduplicates by content snippet.
 */
export function buildKnowledgeBlock(chunks: RagChunk[]): string {
  const seen = new Set<string>();
  let total = 0;
  const parts: string[] = [];

  for (const { content, docTitle, sourceName } of chunks) {
    if (total >= RAG_MAX_CHARS) break;
    const key = content.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = sourceName ? `[${docTitle} — ${sourceName}]` : `[${docTitle}]`;
    const block = `${ref}\n${content}`;
    const take = total + block.length > RAG_MAX_CHARS ? RAG_MAX_CHARS - total : block.length;
    parts.push(block.slice(0, take));
    total += take;
  }

  if (parts.length === 0) return "";
  return [
    "--- Conhecimento (use apenas se for relevante para a pergunta do cliente) ---",
    ...parts,
    "--- Fim do Conhecimento ---",
  ].join("\n\n");
}
