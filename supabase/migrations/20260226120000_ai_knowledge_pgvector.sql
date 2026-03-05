-- Base de Conhecimento (RAG): pgvector + tabelas knowledge + jobs
-- Permite upload de documentos, chunking e busca por similaridade para o agente.

-- 1) Habilitar pgvector (Supabase já pode tê-lo; IF NOT EXISTS evita erro)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Catálogo / grupo de fontes (ex.: "FAQ", "Políticas")
CREATE TABLE IF NOT EXISTS public.barbershop_ai_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_sources_barbershop_idx
  ON public.barbershop_ai_knowledge_sources (barbershop_id);

COMMENT ON TABLE public.barbershop_ai_knowledge_sources IS 'Catalog/group for knowledge documents (e.g. FAQ, Policies)';

-- 3) Documentos (metadados + S3 ref)
CREATE TABLE IF NOT EXISTS public.barbershop_ai_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.barbershop_ai_knowledge_sources(id) ON DELETE SET NULL,
  title text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint,
  s3_bucket text,
  s3_key text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  last_error text,
  checksum_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_documents_barbershop_status_idx
  ON public.barbershop_ai_knowledge_documents (barbershop_id, status);
CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_documents_source_idx
  ON public.barbershop_ai_knowledge_documents (source_id);

COMMENT ON TABLE public.barbershop_ai_knowledge_documents IS 'Knowledge documents (file metadata + S3 ref); status tracks processing pipeline';

-- 4) Chunks com embedding (vector 1536 = text-embedding-3-small)
CREATE TABLE IF NOT EXISTS public.barbershop_ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.barbershop_ai_knowledge_documents(id) ON DELETE CASCADE,
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  token_estimate int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_chunks_barbershop_idx
  ON public.barbershop_ai_knowledge_chunks (barbershop_id);
CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_chunks_document_idx
  ON public.barbershop_ai_knowledge_chunks (document_id, chunk_index);

-- Índice vetorial para busca por similaridade (cosine distance)
CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_chunks_embedding_idx
  ON public.barbershop_ai_knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE public.barbershop_ai_knowledge_chunks IS 'Text chunks with embeddings for RAG retrieval';

-- 5) Fila de processamento (extract + embed)
CREATE TABLE IF NOT EXISTS public.barbershop_ai_knowledge_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.barbershop_ai_knowledge_documents(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('extract', 'embed')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_jobs_status_run_after_idx
  ON public.barbershop_ai_knowledge_jobs (status, run_after)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS barbershop_ai_knowledge_jobs_barbershop_idx
  ON public.barbershop_ai_knowledge_jobs (barbershop_id);

COMMENT ON TABLE public.barbershop_ai_knowledge_jobs IS 'Queue for document processing (extract text, chunk, embed)';

-- 6) Versionamento: snapshot de settings + knowledge nas versões de prompt
ALTER TABLE public.barbershop_ai_prompt_versions
  ADD COLUMN IF NOT EXISTS settings_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS knowledge_snapshot jsonb;

COMMENT ON COLUMN public.barbershop_ai_prompt_versions.settings_snapshot IS 'Frozen snapshot: model, temperature, limits, typing, handoff settings at publish time';
COMMENT ON COLUMN public.barbershop_ai_prompt_versions.knowledge_snapshot IS 'Frozen snapshot: active source/doc ids (or hash) at publish time';
