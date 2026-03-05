import { createRequire } from "node:module";
import { pool } from "../db.js";
import { config } from "../config.js";
import { getObjectAsBuffer, isKnowledgeStorageConfigured } from "../lib/s3.js";
import OpenAI from "openai";
import mammoth from "mammoth";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const WORKER_ID = `knowledge-${process.pid}-${Date.now()}`;
const POLL_MS = 5000;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 120;
const EMBED_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_SECONDS = 2;

type JobRow = {
  id: string;
  barbershop_id: string;
  document_id: string;
  type: string;
  attempts: number;
};

type DocRow = {
  id: string;
  barbershop_id: string;
  s3_key: string | null;
  mime_type: string;
  title: string;
};

function backoffSeconds(attempts: number): number {
  return Math.min(Math.pow(BACKOFF_BASE_SECONDS, attempts), 3600);
}

async function getNextJob(): Promise<JobRow | null> {
  const r = await pool.query<JobRow>(
    `UPDATE public.barbershop_ai_knowledge_jobs
     SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT j.id
       FROM public.barbershop_ai_knowledge_jobs j
       WHERE j.status = 'queued' AND j.run_after <= now()
       ORDER BY j.created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, document_id, type, attempts`,
    [WORKER_ID]
  );
  return r.rows[0] ?? null;
}

async function markJobDone(jobId: string): Promise<void> {
  await pool.query(
    `UPDATE public.barbershop_ai_knowledge_jobs
     SET status = 'done', locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [jobId]
  );
}

async function markJobFailed(
  jobId: string,
  documentId: string,
  errorMessage: string,
  attempts: number,
  setDocFailed: boolean
): Promise<void> {
  const errTruncated = errorMessage.slice(0, 2048);
  if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE public.barbershop_ai_knowledge_jobs
       SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error = $1, updated_at = now()
       WHERE id = $2`,
      [errTruncated, jobId]
    );
    if (setDocFailed) {
      await pool.query(
        `UPDATE public.barbershop_ai_knowledge_documents
         SET status = 'failed', last_error = $1, updated_at = now()
         WHERE id = $2`,
        [errTruncated, documentId]
      );
    }
  } else {
    const runAfter = new Date(Date.now() + backoffSeconds(attempts) * 1000);
    await pool.query(
      `UPDATE public.barbershop_ai_knowledge_jobs
       SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = $1, run_after = $2, updated_at = now()
       WHERE id = $3`,
      [errTruncated, runAfter, jobId]
    );
  }
}

async function getDocument(documentId: string, barbershopId: string): Promise<DocRow | null> {
  const r = await pool.query<DocRow>(
    `SELECT id, barbershop_id, s3_key, mime_type, title
     FROM public.barbershop_ai_knowledge_documents
     WHERE id = $1 AND barbershop_id = $2`,
    [documentId, barbershopId]
  );
  return r.rows[0] ?? null;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;
  const normalized = normalizeText(text);
  if (!normalized.length) return chunks;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const lastSpace = normalized.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(normalized.slice(start, end));
    start = end - (end - start > overlap ? overlap : 0);
    if (start >= end) start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  _title: string
): Promise<string> {
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("pdf")) {
    const data = await pdfParse(buffer);
    return typeof data.text === "string" ? data.text : "";
  }
  if (
    mime.includes("vnd.openxmlformats") ||
    mime === "application/docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }
  if (
    mime.includes("text/plain") ||
    mime.includes("text/markdown") ||
    mime.includes("text/html")
  ) {
    return buffer.toString("utf-8");
  }
  // Fallback: try as UTF-8 text
  return buffer.toString("utf-8");
}

async function embedChunks(
  openai: OpenAI,
  texts: string[],
  barbershopId: string,
  documentId: string,
  startIndex: number
): Promise<void> {
  if (texts.length === 0) return;
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  const order = response.data
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
  if (order.length !== texts.length) {
    throw new Error(`Embedding count mismatch: got ${order.length}, expected ${texts.length}`);
  }
  for (let i = 0; i < texts.length; i++) {
    const embedding = order[i]!;
    const content = texts[i]!;
    const chunkIndex = startIndex + i;
    const tokenEstimate = Math.ceil(content.length / 4);
    const vectorStr = `[${embedding.join(",")}]`;
    await pool.query(
      `INSERT INTO public.barbershop_ai_knowledge_chunks
       (document_id, barbershop_id, chunk_index, content, embedding, token_estimate)
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       ON CONFLICT (document_id, chunk_index) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         token_estimate = EXCLUDED.token_estimate`,
      [documentId, barbershopId, chunkIndex, content, vectorStr, tokenEstimate]
    );
  }
}

async function processExtractJob(
  jobId: string,
  documentId: string,
  barbershopId: string,
  attempts: number
): Promise<void> {
  const doc = await getDocument(documentId, barbershopId);
  if (!doc?.s3_key) {
    await markJobFailed(
      jobId,
      documentId,
      "Document or s3_key not found",
      attempts,
      true
    );
    return;
  }
  if (!isKnowledgeStorageConfigured()) {
    await markJobFailed(jobId, documentId, "S3 not configured", attempts, true);
    return;
  }
  const buffer = await getObjectAsBuffer(doc.s3_key);
  if (!buffer) {
    await markJobFailed(jobId, documentId, "File not found in S3", attempts, true);
    return;
  }
  const rawText = await extractTextFromBuffer(buffer, doc.mime_type, doc.title);
  const text = normalizeText(rawText);
  if (!text.length) {
    await pool.query(
      `UPDATE public.barbershop_ai_knowledge_documents SET status = 'ready', last_error = NULL, updated_at = now() WHERE id = $1`,
      [documentId]
    );
    await markJobDone(jobId);
    return;
  }
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    await pool.query(
      `UPDATE public.barbershop_ai_knowledge_documents SET status = 'ready', last_error = NULL, updated_at = now() WHERE id = $1`,
      [documentId]
    );
    await markJobDone(jobId);
    return;
  }
  const openaiApiKey = config.openaiApiKey;
  if (!openaiApiKey) {
    await markJobFailed(jobId, documentId, "OPENAI_API_KEY not set", attempts, true);
    return;
  }
  const openai = new OpenAI({ apiKey: openaiApiKey });
  await pool.query(
    `DELETE FROM public.barbershop_ai_knowledge_chunks WHERE document_id = $1`,
    [documentId]
  );
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    await embedChunks(openai, batch, barbershopId, documentId, i);
  }
  await pool.query(
    `UPDATE public.barbershop_ai_knowledge_documents SET status = 'ready', last_error = NULL, updated_at = now() WHERE id = $1`,
    [documentId]
  );
  await markJobDone(jobId);
}

async function processOneJob(): Promise<boolean> {
  const job = await getNextJob();
  if (!job) return false;

  const { id: jobId, barbershop_id: barbershopId, document_id: documentId, type, attempts } = job;
  console.info(
    "[knowledge-worker] processing jobId=%s documentId=%s type=%s attempts=%s",
    jobId,
    documentId,
    type,
    attempts
  );

  try {
    if (type === "extract" || type === "embed") {
      await processExtractJob(jobId, documentId, barbershopId, attempts);
    } else {
      await markJobFailed(jobId, documentId, `Unknown job type: ${type}`, attempts, true);
    }
    return true;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("[knowledge-worker] job %s error:", jobId, errMsg);
    await markJobFailed(jobId, documentId, errMsg, attempts, true);
    return true;
  }
}

export async function runKnowledgeWorkerCycle(options?: {
  maxJobs?: number;
}): Promise<{ processed: number }> {
  const maxJobs = options?.maxJobs ?? 1;
  let processed = 0;
  while (processed < maxJobs) {
    const did = await processOneJob();
    if (!did) break;
    processed++;
  }
  return { processed };
}

async function runLoop(): Promise<void> {
  console.info("[knowledge-worker] started %s", WORKER_ID);
  while (true) {
    await runKnowledgeWorkerCycle({ maxJobs: 2 });
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  runLoop().catch((e) => {
    console.error("[knowledge-worker] fatal:", e);
    process.exit(1);
  });
}
