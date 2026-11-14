-- Contadores de rate limit dos endpoints públicos (agendar / reagendar / cancelar).
-- Janela fixa por bucket; o backend incrementa de forma atômica (INSERT .. ON CONFLICT DO UPDATE)
-- e apaga linhas antigas de forma oportunista. Só o backend acessa (sem policies = RLS nega o resto).
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  bucket       TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_window_start ON public.rate_limit_hits (window_start);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
