-- Migration: Agent profile, additional_instructions, prompt versions, sandbox flag
-- For WhatsAppAgentSelfTuning: perfil estruturado, versionamento e simulação

-- 1) Tabela de versões de prompt (criada antes para FK em barbershop_ai_settings)
CREATE TABLE IF NOT EXISTS public.barbershop_ai_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  agent_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  additional_instructions text,
  compiled_prompt_preview text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'rolled_back')),
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS barbershop_ai_prompt_versions_barbershop_status_idx
  ON public.barbershop_ai_prompt_versions (barbershop_id, status);

-- 2) Estender barbershop_ai_settings
ALTER TABLE public.barbershop_ai_settings
  ADD COLUMN IF NOT EXISTS agent_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS additional_instructions text,
  ADD COLUMN IF NOT EXISTS active_prompt_version_id uuid REFERENCES public.barbershop_ai_prompt_versions(id) ON DELETE SET NULL;

-- Migrar system_prompt_override existente para additional_instructions (uma vez; não sobrescrever se já houver)
UPDATE public.barbershop_ai_settings
SET additional_instructions = COALESCE(additional_instructions, system_prompt_override)
WHERE system_prompt_override IS NOT NULL AND (additional_instructions IS NULL OR additional_instructions = '');

-- 3) Sandbox: flag em ai_conversations para simulação sem afetar produção
ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_conversations_barbershop_sandbox_idx
  ON public.ai_conversations (barbershop_id, is_sandbox)
  WHERE is_sandbox = true;

COMMENT ON COLUMN public.barbershop_ai_settings.agent_profile IS 'Structured profile: tonePreset, emojiLevel, slangLevel, verbosity, salesStyle, hardRules';
COMMENT ON COLUMN public.barbershop_ai_settings.additional_instructions IS 'Optional advanced instructions; validated for forbidden patterns';
COMMENT ON COLUMN public.ai_conversations.is_sandbox IS 'When true, conversation is from simulation/preview and not real WhatsApp';
