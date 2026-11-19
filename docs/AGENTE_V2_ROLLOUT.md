# Ativação do agente v2

O motor v2 vem desligado. Siga as etapas em ordem e só avance quando o critério for cumprido.

## 1. Preparar

1. Aplique as migrações `20261118120000_ai_model_gpt_6_luna.sql` e `20261118130000_ai_agent_v2.sql`.
2. Publique a API e os workers.
3. Rode `npm run eval:understanding` e `npm run eval:v2` em ambiente local.

## 2. Sombra

Defina `AI_AGENT_SHADOW_BARBERSHOPS` com o id da barbearia piloto. O cliente continua atendido pelo motor atual.

```sql
SELECT conversation_state, rules->>'primary' AS regras, interpretation->>'primary' AS llm, user_text
FROM public.ai_turn_shadow
WHERE agrees = false
ORDER BY created_at DESC
LIMIT 100;
```

**Critério:** revisar as divergências por uma semana e não encontrar leitura errada de cancelamento, presença ou remarcação. As linhas são apagadas após 30 dias.

## 3. Piloto

```sql
UPDATE public.barbershop_ai_settings
SET agent_engine = 'v2', updated_at = now()
WHERE barbershop_id = '<id da barbearia piloto>';
```

**Critério:** uma semana sem gravação incorreta, com conversas revisadas por amostragem.

## 4. Expansão

Ative as demais barbearias em grupos. Para usar só templates, defina `AI_AGENT_V2_COMPOSER=false`.

**Critério:** duas semanas com todo o tráfego no v2, sem reversão.

## Reversão

```sql
UPDATE public.barbershop_ai_settings
SET agent_engine = 'legacy', updated_at = now()
WHERE barbershop_id = '<id da barbearia>';
```

Conversas novas voltam ao motor antigo. Para mover também as conversas em andamento:

```sql
UPDATE public.ai_conversation_runtime r
SET agent_engine = 'legacy', updated_at = now()
FROM public.ai_conversations c
WHERE c.id = r.conversation_id AND c.barbershop_id = '<id da barbearia>';
```

## Remoção do legado

Só depois do critério da etapa 4:

1. Migrar o fluxo de planos, hoje delegado ao legado.
2. Trocar o simulador e o sandbox para o motor v2.
3. Remover o laço de ferramentas e os detectores `looksLike*` e `assistant*` de `agent.ts`.
4. Remover `agent_engine`, a tabela de sombra e as flags desta página.
