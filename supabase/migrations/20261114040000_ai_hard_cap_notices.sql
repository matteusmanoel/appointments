-- Aviso ao cliente final no teto de uso da IA (2x o limite do plano): no máximo 1 por conversa e por mês (yyyy-mm, São Paulo).
-- A linha é gravada ANTES de enviar (claim atômico, evita spam com mensagens simultâneas); a falha transitória de envio
-- é reenviada pelo próprio worker (pending_reply_parts). Ver backend/src/ai/usage-cap.ts.
CREATE TABLE IF NOT EXISTS public.ai_hard_cap_notices (
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  period text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, period)
);
