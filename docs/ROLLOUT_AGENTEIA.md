# Rollout: AgenteIA controle total (RAG, handoff, campanhas)

Este documento descreve o rollout das funcionalidades do plano AgenteIA-controle-total e sugestões de feature flags por plano.

## Funcionalidades entregues

- **Base de Conhecimento (RAG)**: pgvector, tabelas knowledge, worker de processamento (extract/chunk/embed), integração no `runAgent` com topK e threshold de similaridade.
- **Handoff por conversa**: `ai_conversation_runtime`, pausa ao detectar mensagem do próprio número (fromMe) por conversa, endpoints assume/resume por conversa, handoff por keyword.
- **Controles avançados**: `max_output_tokens`, `typing_simulation` em settings e no worker.
- **Identidade do agente**: `displayName`, `nickname`, `role`, `signMessages`, `signatureStyle` no perfil e no prompt.
- **Mensagens manuais e campanhas**: tipos `manual` e `campaign` em `scheduled_messages`, tabelas `message_templates` e `message_campaigns`, API de templates e campanhas, guardrails (opt-out, dedupe).
- **Versionamento com snapshot**: ao publicar, gravação de `settings_snapshot` e `knowledge_snapshot`; ao dar rollback, restauração de settings a partir do snapshot.

## Feature flags por plano (sugestão)

| Recurso              | Essential | Pro | Premium |
|----------------------|-----------|-----|---------|
| RAG (base conhecimento) | Não       | Sim (N docs limitado) | Sim (mais docs, topK maior) |
| Handoff por conversa | Sim       | Sim | Sim     |
| Controles (tokens, typing) | Sim   | Sim | Sim     |
| Identidade/assinatura | Sim      | Sim | Sim     |
| Mensagem manual      | Não       | Sim | Sim     |
| Campanhas            | Não       | Não | Sim     |
| Snapshot em versões  | Sim       | Sim | Sim     |

Implementação sugerda: checar `billing_plan` do barbershop nas rotas de knowledge (limite de documentos), campanhas (apenas premium) e mensagem manual (apenas pro/premium). Os limites exatos (ex.: N docs para Pro) podem ser configurados por env ou tabela de planos.

## Logs e métricas

- **RAG**: já existe `console.warn` em falha de retrieval no agent; opcional: logar tamanho do bloco injetado (sem conteúdo) para métricas.
- **Handoff**: eventos em `ai_handoff_events` para auditoria; logs no webhook e no agent para keyword.
- **Knowledge worker**: logs de jobId, documentId, tipo e erros; métricas podem ser extraídas de CloudWatch (Lambda).

## Testes

- **Webhook**: testes para `fromMe` com `to`/`remoteJid`/`chat.id` retornando `fromPhone` para pausa por conversa.
- **Knowledge**: testes para GET config, GET sources, GET documents, POST source (em `backend/src/__tests__/knowledge-routes.test.ts`).
- **WhatsApp AI**: testes existentes para ai-settings, publish, versions; versões retornam `settings_snapshot` e `knowledge_snapshot`.

## Migrações

Aplicar em ordem:

1. `20260226120000_ai_knowledge_pgvector.sql` – pgvector, knowledge tables, jobs, prompt_versions snapshot columns
2. `20260226140000_ai_conversation_handoff.sql` – ai_conversation_runtime, handoff_settings, handoff_events
3. `20260226150000_ai_advanced_controls.sql` – max_output_tokens, typing_simulation
4. `20260226160000_manual_campaigns_templates.sql` – scheduled_messages type manual/campaign, message_templates, message_campaigns

Em ambientes onde o CHECK de `scheduled_messages.type` tiver nome diferente, ajustar o DROP CONSTRAINT na migração 20260226160000 para o nome correto (ex.: consultar `information_schema.table_constraints`).

## Deploy workers

- **Knowledge worker**: configurar parâmetro `KnowledgeS3Bucket` no stack CloudFormation e garantir que o bucket exista e a Lambda tenha permissão S3. O worker é agendado a cada 5 minutos (EventBridge).
