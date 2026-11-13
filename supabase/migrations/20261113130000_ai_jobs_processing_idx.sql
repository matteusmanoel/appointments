-- Apoia o reaper de ai_jobs presos: varredura só nos jobs em `processing`, por idade do lock.
CREATE INDEX IF NOT EXISTS ai_jobs_processing_locked_idx
  ON public.ai_jobs (locked_at)
  WHERE status = 'processing';
