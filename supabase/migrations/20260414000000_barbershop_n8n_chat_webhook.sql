-- URL do webhook n8n (Production) por barbearia — usada pelo ai-worker quando NATIVE_AI_DISABLED.
ALTER TABLE public.barbershop_ai_settings
  ADD COLUMN IF NOT EXISTS n8n_chat_webhook_url text;

COMMENT ON COLUMN public.barbershop_ai_settings.n8n_chat_webhook_url IS 'POST URL do fluxo n8n (ex.: Webhook API Uazapi). Opcional: fallback N8N_CHAT_TRIGGER_URL no backend.';
