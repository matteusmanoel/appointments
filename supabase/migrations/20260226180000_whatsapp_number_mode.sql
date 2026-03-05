-- WhatsApp number mode: account_wide (same number for all branches) vs per_branch (dedicated per branch).
-- When account_wide, the primary barbershop holds the Uazapi connection; AI routes by selected_barbershop_id per conversation.

-- 1) Account-level preference
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS whatsapp_number_mode text NOT NULL DEFAULT 'per_branch'
  CHECK (whatsapp_number_mode IN ('account_wide', 'per_branch'));

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS whatsapp_primary_barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.accounts.whatsapp_number_mode IS 'account_wide = one number for all branches (AI asks which branch); per_branch = one connection per barbershop.';
COMMENT ON COLUMN public.accounts.whatsapp_primary_barbershop_id IS 'When account_wide: the barbershop where the WhatsApp connection (Uazapi instance) is registered.';

-- 2) Per-conversation selected branch (for account_wide routing)
ALTER TABLE public.ai_conversation_runtime
  ADD COLUMN IF NOT EXISTS selected_barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_conversation_runtime.selected_barbershop_id IS 'When account_wide: filial escolhida pelo cliente nesta conversa; usado pelas ferramentas da IA.';
