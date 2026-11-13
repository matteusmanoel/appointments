# ADR 0003 — Teto diário e fim do disparo automático ao cliente

## Status

Aceito. O teto, o intervalo e a prioridade foram revistos na ADR 0004.

## Contexto

O worker enfileirava sozinho follow-up de 30 dias, follow-up de quem conversou e não marcou, aniversário e cobrança de plano (vencimento, 5º dia e 10º dia). Lembrete e fila de espera saíam sem teto. Isso enche a cadeira sem o operador olhar, e concentra mensagem no mesmo número de atendimento. O risco é a saúde desse número.

## Decisão

Nada que chame o cliente de volta nasce sozinho. Follow-up, aniversário e a conversa sem agendamento viram sugestão de reativação. O que já estava na fila por isso não sai. Cobrança de plano é manual, salvo automático ligado naquele cliente: vencimento e, se o mês seguir em aberto, o 10º dia. Não há 5º dia. O mês fecha quando o operador lança o recebimento.

Disparo ao cliente tem teto de 50 por dia, somando cobrança de plano, reativação, lembrete e fila de espera, com 3 minutos entre um e outro. A prioridade de quem ocupa o próximo intervalo é lembrete, fila de espera, cobrança de plano, reativação. No 51º o sistema não envia e pede que o operador fale pelo WhatsApp e registre o fato no sistema depois. A resposta do agente a quem acabou de escrever fica fora das 50.

Resumo de abertura e aviso de assinatura ficam fora do produto por enquanto. Crédito de follow-up não entra nesta decisão.

## Consequências

A cadeira não se preenche sozinha. Um lembrete pode não sair se as 50 do dia já foram usadas. Fato combinado no WhatsApp do operador só existe na agenda depois que ele registra. Reabrir o disparo automático ou estourar o dia seguinte desfaz a proteção do número.
