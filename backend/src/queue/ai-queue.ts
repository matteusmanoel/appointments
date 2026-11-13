import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

/**
 * Gatilho por evento do worker de IA.
 *
 * Fluxo: o webhook grava/atualiza o ai_job no banco (run_after = agora + janela de silêncio) e chama
 * `notifyAiJobScheduled(quietSecs)`. A mensagem entra na fila com DelaySeconds = janela de silêncio, então
 * o Lambda do worker acorda exatamente quando o job fica elegível, em vez de esperar o próximo minuto do
 * EventBridge. Cada nova mensagem do cliente "empurra" o run_after no banco (debounce de verdade) e dispara
 * outro aviso; avisos antigos acordam o worker cedo, ele não acha job elegível e volta a dormir (barato).
 *
 * Sem AI_JOBS_QUEUE_URL não faz nada: o comportamento antigo (EventBridge a cada minuto) continua valendo,
 * que também segue como rede de segurança (retries/backoff). Nunca lança: falha ao avisar não pode derrubar o webhook.
 */
const MAX_SQS_DELAY_SECONDS = 900;

let client: SQSClient | null = null;
let clientFactory: () => Pick<SQSClient, "send"> = () => (client ??= new SQSClient({}));

/** Só para testes. */
export function __setSqsClientFactoryForTests(f: (() => Pick<SQSClient, "send">) | null): void {
  clientFactory = f ?? (() => (client ??= new SQSClient({})));
}

export function clampSqsDelaySeconds(secs: number): number {
  if (!Number.isFinite(secs) || secs < 0) return 0;
  return Math.min(Math.floor(secs), MAX_SQS_DELAY_SECONDS);
}

export async function notifyAiJobScheduled(
  quietSecs: number,
  meta: { barbershopId?: string; conversationId?: string } = {},
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const queueUrl = env.AI_JOBS_QUEUE_URL;
  if (!queueUrl) return false;
  try {
    await clientFactory().send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ type: "ai_job_scheduled", ...meta }),
        DelaySeconds: clampSqsDelaySeconds(quietSecs),
      }),
    );
    return true;
  } catch (e) {
    console.warn("[ai-queue] falha ao avisar a fila (o EventBridge cobre):", e instanceof Error ? e.message : e);
    return false;
  }
}
