import { runAiWorkerCycle } from "./ai-worker.js";

type SqsEventLike = { Records?: Array<{ eventSource?: string; messageId?: string }> };

/**
 * Entrada única do worker de IA: acionada pela fila SQS (gatilho por evento, logo após a janela de silêncio)
 * e pelo EventBridge a cada minuto (rede de segurança para retries/backoff). Um ciclo processa todos os jobs
 * elegíveis, então um lote SQS inteiro é atendido por um único ciclo.
 */
export async function handler(
  event?: SqsEventLike,
): Promise<{ statusCode: number; body: string } | { batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const fromSqs = Array.isArray(event?.Records) && event!.Records!.some((r) => r.eventSource === "aws:sqs");
  try {
    const result = await runAiWorkerCycle({ maxJobs: 10 });
    if (fromSqs) return { batchItemFailures: [] };
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error("[lambda-ai] error:", e);
    if (fromSqs) {
      // devolve o lote à fila (visibilidade → nova tentativa; depois de maxReceiveCount vai para a DLQ)
      return { batchItemFailures: event!.Records!.map((r) => ({ itemIdentifier: r.messageId ?? "" })).filter((x) => x.itemIdentifier) };
    }
    return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
  }
}
