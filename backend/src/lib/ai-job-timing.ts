/**
 * Tempos do job de IA, numa constante só para o inbound (API), o worker e o reaper.
 *
 * Fonte: `infra/production/main.tf`, função `worker_ai` com `timeout = 180` (o teste `ai-job-timing.test.ts` lê o
 * Terraform e falha se alguém mudar o timeout da Lambda sem rever este valor).
 *
 * Um job em `processing` com lock mais novo que `aiJobProcessingTimeoutSeconds()` ainda PODE estar rodando:
 *  - o inbound não cria job novo para a conversa nesse período;
 *  - o reaper não o devolve à fila antes disso.
 * Passado o limite (Lambda + margem) a Lambda já morreu, então é seguro devolver/encerrar.
 */
export const AI_WORKER_LAMBDA_TIMEOUT_SECONDS = 180;
export const AI_JOB_LOCK_MARGIN_SECONDS = 60;
export const DEFAULT_AI_JOB_PROCESSING_TIMEOUT_SECONDS = AI_WORKER_LAMBDA_TIMEOUT_SECONDS + AI_JOB_LOCK_MARGIN_SECONDS; // 240
/** Piso: nunca devolver um job antes de a Lambda ter morrido (timeout + 15 s), mesmo que a env peça menos. */
export const MIN_AI_JOB_PROCESSING_TIMEOUT_SECONDS = AI_WORKER_LAMBDA_TIMEOUT_SECONDS + 15;

let warned = false;

export function resolveAiJobProcessingTimeoutSeconds(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AI_JOB_PROCESSING_TIMEOUT_SECONDS;
  if (raw < MIN_AI_JOB_PROCESSING_TIMEOUT_SECONDS) {
    if (!warned) {
      warned = true;
      console.warn(
        "[ai-job-timing] AI_JOB_PROCESSING_TIMEOUT_SECONDS=%s é menor que o timeout da Lambda (%ss) + 15s; usando %ss",
        raw,
        AI_WORKER_LAMBDA_TIMEOUT_SECONDS,
        MIN_AI_JOB_PROCESSING_TIMEOUT_SECONDS,
      );
    }
    return MIN_AI_JOB_PROCESSING_TIMEOUT_SECONDS;
  }
  return raw;
}
