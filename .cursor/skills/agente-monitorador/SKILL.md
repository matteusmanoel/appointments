---
name: agente-monitorador
description: Lê o pacote de fichas do agente da barbearia, agrupa quebras de contrato e escreve o relatório para aprovação humana. Não corrige o agente.
disable-model-invocation: true
---

# Agente monitorador

Use quando pedirem para avaliar conversas do agente no WhatsApp, ler o pacote do monitor ou dizer se uma falha é recorrente.

## O que ler

Somente `backend/.lab/monitor-packet.json`, gerado por `npx tsx scripts/select-monitor-packet.ts`. Não leia o scroll do WhatsApp, o log cru nem o histórico inteiro de `ai_messages`. Se o pacote não existir, pare e peça para gerá-lo.

Os campos do pacote servem para você entender o caso. Eles não aparecem no relatório.

## O que escrever

Um arquivo `backend/.lab/monitor-report.md` que uma pessoa da barbearia consiga revisar sem conhecer o código.

Ordene pelo que deve ser atacado primeiro. Junte no mesmo item os grupos que são o mesmo erro visto por ângulos diferentes. Cada item tem, nesta ordem:

- Prioridade: agora, agora se sobrar, ou depois. Diga em quantas conversas aconteceu e se é repetido ou um caso só.
- O que o cliente queria, no fio da conversa, não numa frase isolada.
- O que o agente fez ou deixou de fazer.
- Um trecho curto, com as falas reais do exemplar.
- Como corrigir, numa frase de comportamento: o que deve acontecer na próxima mensagem.
- O que não fazer: não vale lista de palavras, marca, modelo ou frase pronta.
- Uma pergunta de sim ou não, para a pessoa dizer se esse é o lugar onde atacar.

Itens de fila e de plano ficam em “depois” e só pedem para serem registrados, salvo se o pacote mostrar que travam a marcação comum.

## Proibido no texto do relatório

- Nomes de campo, de tool, de estado interno e de arquivo.
- Palavras como lista fechada, orquestrador, compositor, guardrail, assinatura, ficha e rastro.
- Editar o agente, o prompt ou os testes nesta sessão.
- Tratar o sim do relatório como ordem para corrigir. A correção começa só numa leva seguinte, nos itens marcados como agora.

## Fecho

Feche dizendo o que ficou de fora do teto, sem diagnosticar esses casos. Não implemente nada depois das perguntas.
