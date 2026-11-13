# Cobrança: o que a assinatura governa (PR #11)

## Estados e tolerância
`past_due`/`incomplete`/`unpaid` → tolerância de `BILLING_GRACE_DAYS` (padrão 7) a partir de `subscription_status_changed_at`; depois, **bloqueado**.
`canceled` → segue até `subscription_current_period_end`. Sem assinatura Stripe (PIX/manual/legado) → liberado. O painel continua acessível (o dono precisa conseguir pagar).

## Onde o bloqueio vale (assinatura inativa depois da carência)
| Superfície | Efeito |
|---|---|
| IA nativa e ramo n8n do worker de IA (`aiGateState`) | não responde; Essencial (limite 0) também |
| Worker agendado (cobrança de plano, reativação, lembretes…) | mensagens viram `skipped` |
| Aviso de lista de espera (`record-agenda-change`) | não envia |
| **`/api/tools/*`** | **402 `subscription_blocked`** |
| **Eventos para o n8n (`outbound/n8n-events`)** | **evento `dead` com motivo, não é enviado** |
| **Conectar WhatsApp** (`/connect`, `/uazapi/start`, `/uazapi/link-existing`) | **402** com assinatura bloqueada; **403 `plan_required`** no plano Essencial (só Pro/Premium conectam) |

Quem já está conectado não é desconectado: só a nova conexão/vínculo é barrada. Eventos e mensagens ignorados enquanto bloqueado **não são reprocessados** depois do pagamento (decisão: evitar rajada de mensagens atrasadas).

## Aviso ao dono quando o pagamento falha (e-mail, atrás de flag)
- Flag: `BILLING_NOTIFY_PAYMENT_FAILED` (Terraform: `billing_notify_payment_failed`, **padrão false**). Nada é enviado com a flag desligada.
- Para ligar: `FROM_EMAIL` precisa ser identidade verificada no SES. Sem `FROM_EMAIL` o envio **falha** (antes retornava «enviado»).
- **Dedupe só depois do envio**: `billing_notice_log` só recebe a linha quando o e-mail saiu. Falha do SES, `FROM_EMAIL` ausente e dono sem e-mail não perdem o aviso: ele fica pendente.
- **Reenvio**: a cada ciclo do worker agendado (no máx. 1x/15 min por processo) `retryPaymentFailedNotices` reenvia para barbearias ainda na tolerância sem aviso registrado desde a mudança de status.
- Duas execuções simultâneas da mesma fatura são serializadas por advisory lock (um e-mail só). Entrega é *at-least-once*: se o processo morrer entre o envio e o `COMMIT`, o reenvio pode duplicar um e-mail.
- Data limite do e-mail = `subscription_status_changed_at + BILLING_GRACE_DAYS` (a mesma conta do bloqueio).
- **Não implementado**: aviso por WhatsApp ao dono.

## Testes
`billing-followup.test.ts` e `billing-notify-gates.test.ts` exigem **banco descartável com as migrations aplicadas** (falham sem ele; `runScheduledMessagesCycle` drena a fila global de `scheduled_messages`, nunca rode contra dados reais).
