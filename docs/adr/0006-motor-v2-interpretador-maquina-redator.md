# ADR 0006: motor v2 com interpretador, máquina de estados e redator

## Status

Aceito. O motor v2 está implementado e desligado por padrão. Substitui a ADR 0002 quando o legado for removido.

## Contexto

A ADR 0002 separou entendimento, orquestração e redação, mas a separação não foi concluída. O `runAgent` continuou com cerca de 3.800 linhas, a intenção vinha de regex sobre a última mensagem e parte do estado era deduzida do texto enviado ao cliente. Por isso a redação não podia variar sem quebrar o fluxo.

## Decisão

Cada turno passa por quatro etapas:

1. **Interpretador** (`agent/turn-interpreter.ts`): o LLM lê histórico, estado e catálogo e devolve JSON com schema estrito. O código valida ids, datas e horários.
2. **Máquina de estados** (`agent/v2/machine.ts`): XState puro. É a única fonte do estado da conversa e decide a próxima ação.
3. **Motor** (`agent/v2/engine.ts`): executa os comandos com as ferramentas de agenda existentes.
4. **Redator** (`agent/v2/composer.ts`): parte de um template com os fatos, e o LLM só varia a redação. Se um fato mudar, sai o template.

Continuam determinísticos: disponibilidade, travas, confirmação antes de gravar, validade da oferta, limites de envio e isolamento entre barbearias. Confirmações de escrita, chave PIX e atendimento humano têm texto fixo.

## Consequências

- O estado fica em `ai_conversation_runtime.agent_state`, e a redação deixa de influenciar o fluxo.
- Cada conversa fica no motor em que começou (`ai_conversation_runtime.agent_engine`).
- Pedido de plano ainda é delegado ao legado. Esse fluxo precisa migrar antes da remoção.
- Cada turno faz uma chamada de interpretação e, em muitos casos, uma de redação.

## Reversão

Defina `barbershop_ai_settings.agent_engine = 'legacy'`. Conversas novas voltam ao motor antigo. Veja `docs/AGENTE_V2_ROLLOUT.md`.
