import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { getBarbershopId } from "../middleware/auth.js";
import {
  buildKnowledgeKey,
  createPresignedPutUrl,
  deleteObject as s3DeleteObject,
  isKnowledgeStorageConfigured,
} from "../lib/s3.js";

export const knowledgeRouter = Router();

const createSourceBody = z.object({ name: z.string().min(1).max(200) });
const updateSourceBody = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
});

/** GET /api/integrations/whatsapp/knowledge/sources */
knowledgeRouter.get("/sources", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query<{
      id: string;
      name: string;
      enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, enabled, created_at, updated_at
       FROM public.barbershop_ai_knowledge_sources
       WHERE barbershop_id = $1 ORDER BY name`,
      [barbershopId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("knowledge sources list:", e);
    res.status(500).json({ error: "Failed to list sources" });
  }
});

/** POST /api/integrations/whatsapp/knowledge/sources */
knowledgeRouter.post("/sources", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = createSourceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const r = await pool.query<{ id: string; name: string; enabled: boolean; created_at: string }>(
      `INSERT INTO public.barbershop_ai_knowledge_sources (barbershop_id, name, updated_at)
       VALUES ($1, $2, now()) RETURNING id, name, enabled, created_at`,
      [barbershopId, parsed.data.name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("knowledge source create:", e);
    res.status(500).json({ error: "Failed to create source" });
  }
});

/** PATCH /api/integrations/whatsapp/knowledge/sources/:id */
knowledgeRouter.patch("/sources/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const id = req.params.id;
    const parsed = updateSourceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (parsed.data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(parsed.data.name);
    }
    if (parsed.data.enabled !== undefined) {
      updates.push(`enabled = $${idx++}`);
      values.push(parsed.data.enabled);
    }
    if (updates.length === 0) {
      const r = await pool.query(
        `SELECT id, name, enabled, created_at, updated_at FROM public.barbershop_ai_knowledge_sources WHERE id = $1 AND barbershop_id = $2`,
        [id, barbershopId]
      );
      if (r.rows.length === 0) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      res.json(r.rows[0]);
      return;
    }
    updates.push(`updated_at = now()`);
    values.push(id, barbershopId);
    const r = await pool.query<{ id: string; name: string; enabled: boolean; created_at: string; updated_at: string }>(
      `UPDATE public.barbershop_ai_knowledge_sources SET ${updates.join(", ")}
       WHERE id = $${idx} AND barbershop_id = $${idx + 1}
       RETURNING id, name, enabled, created_at, updated_at`,
      values
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    res.json(r.rows[0]);
  } catch (e) {
    console.error("knowledge source update:", e);
    res.status(500).json({ error: "Failed to update source" });
  }
});

/** GET /api/integrations/whatsapp/knowledge/documents */
knowledgeRouter.get("/documents", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const sourceId = (req.query.source_id as string) || undefined;
    let query = `SELECT id, barbershop_id, source_id, title, original_filename, mime_type, size_bytes, status, last_error, created_at, updated_at
       FROM public.barbershop_ai_knowledge_documents WHERE barbershop_id = $1`;
    const params: string[] = [barbershopId];
    if (sourceId) {
      params.push(sourceId);
      query += ` AND source_id = $2`;
    }
    query += ` ORDER BY created_at DESC`;
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (e) {
    console.error("knowledge documents list:", e);
    res.status(500).json({ error: "Failed to list documents" });
  }
});

const createDocumentBody = z.object({
  title: z.string().min(1).max(300),
  original_filename: z.string().min(1).max(500),
  mime_type: z.string().min(1).max(100),
  source_id: z.string().uuid().nullable().optional(),
});

/** POST /api/integrations/whatsapp/knowledge/documents — create row + return presigned URL */
knowledgeRouter.post("/documents", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isKnowledgeStorageConfigured()) {
      res.status(503).json({ error: "Knowledge storage (S3) is not configured" });
      return;
    }
    const barbershopId = getBarbershopId(req);
    const parsed = createDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { title, original_filename, mime_type, source_id } = parsed.data;
    const r = await pool.query<{
      id: string;
      s3_bucket: string | null;
      s3_key: string | null;
    }>(
      `INSERT INTO public.barbershop_ai_knowledge_documents
       (barbershop_id, source_id, title, original_filename, mime_type, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'uploaded', now())
       RETURNING id, s3_bucket, s3_key`,
      [barbershopId, source_id ?? null, title, original_filename, mime_type]
    );
    const row = r.rows[0]!;
    const bucket = process.env.KNOWLEDGE_S3_BUCKET ?? null;
    const key = buildKnowledgeKey(barbershopId, row.id, original_filename);
    await pool.query(
      `UPDATE public.barbershop_ai_knowledge_documents SET s3_bucket = $1, s3_key = $2, updated_at = now() WHERE id = $3`,
      [bucket, key, row.id]
    );
    const uploadUrl = await createPresignedPutUrl(key, mime_type);
    res.status(201).json({
      id: row.id,
      title,
      original_filename,
      mime_type,
      status: "uploaded",
      upload_url: uploadUrl,
      s3_key: key,
    });
  } catch (e) {
    console.error("knowledge document create:", e);
    res.status(500).json({ error: "Failed to create document" });
  }
});

const completeDocumentBody = z.object({
  checksum_sha256: z.string().max(64).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

/** POST /api/integrations/whatsapp/knowledge/documents/:id/complete — after front uploads to S3 */
knowledgeRouter.post("/documents/:id/complete", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const documentId = req.params.id;
    const parsed = completeDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const r = await pool.query<{ id: string; s3_key: string | null; status: string }>(
      `SELECT id, s3_key, status FROM public.barbershop_ai_knowledge_documents
       WHERE id = $1 AND barbershop_id = $2`,
      [documentId, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const doc = r.rows[0]!;
    if (doc.status !== "uploaded") {
      res.status(400).json({ error: "Document already processing or processed" });
      return;
    }
    await pool.query(
      `UPDATE public.barbershop_ai_knowledge_documents
       SET status = 'processing', checksum_sha256 = $1, size_bytes = $2, updated_at = now()
       WHERE id = $3`,
      [parsed.data.checksum_sha256 ?? null, parsed.data.size_bytes ?? null, documentId]
    );
    await pool.query(
      `INSERT INTO public.barbershop_ai_knowledge_jobs (barbershop_id, document_id, type, status, updated_at)
       VALUES ($1, $2, 'extract', 'queued', now())`,
      [barbershopId, documentId]
    );
    res.json({ id: documentId, status: "processing" });
  } catch (e) {
    console.error("knowledge document complete:", e);
    res.status(500).json({ error: "Failed to complete document upload" });
  }
});

/** DELETE /api/integrations/whatsapp/knowledge/documents/:id */
knowledgeRouter.delete("/documents/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const documentId = req.params.id;
    const r = await pool.query<{ id: string; s3_key: string | null }>(
      `SELECT id, s3_key FROM public.barbershop_ai_knowledge_documents WHERE id = $1 AND barbershop_id = $2`,
      [documentId, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const doc = r.rows[0]!;
    if (doc.s3_key && isKnowledgeStorageConfigured()) {
      try {
        await s3DeleteObject(doc.s3_key);
      } catch (e) {
        console.warn("knowledge document delete S3:", e);
      }
    }
    await pool.query(
      `DELETE FROM public.barbershop_ai_knowledge_documents WHERE id = $1 AND barbershop_id = $2`,
      [documentId, barbershopId]
    );
    res.status(204).send();
  } catch (e) {
    console.error("knowledge document delete:", e);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

/** GET /api/integrations/whatsapp/knowledge/config — whether S3 is configured */
knowledgeRouter.get("/config", async (_req: Request, res: Response): Promise<void> => {
  res.json({ storage_configured: isKnowledgeStorageConfigured() });
});
