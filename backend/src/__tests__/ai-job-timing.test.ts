import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_WORKER_LAMBDA_TIMEOUT_SECONDS,
  DEFAULT_AI_JOB_PROCESSING_TIMEOUT_SECONDS,
  MIN_AI_JOB_PROCESSING_TIMEOUT_SECONDS,
  resolveAiJobProcessingTimeoutSeconds,
} from "../lib/ai-job-timing.js";

describe("tempos do job de IA alinhados com a Lambda", () => {
  it("o timeout da Lambda worker_ai no Terraform é o que a constante assume (mudou lá? revise aqui)", () => {
    const tf = readFileSync(resolve(process.cwd(), "../infra/production/main.tf"), "utf8");
    const block = tf.slice(tf.indexOf('resource "aws_lambda_function" "worker_ai"'));
    const m = block.match(/timeout\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(AI_WORKER_LAMBDA_TIMEOUT_SECONDS);
  });

  it("limite padrão = Lambda + margem (240 s), piso = Lambda + 15 s", () => {
    expect(DEFAULT_AI_JOB_PROCESSING_TIMEOUT_SECONDS).toBe(240);
    expect(MIN_AI_JOB_PROCESSING_TIMEOUT_SECONDS).toBe(195);
  });

  it("env abaixo do piso é elevada ao piso; inválida cai no padrão; acima do piso é respeitada", () => {
    expect(resolveAiJobProcessingTimeoutSeconds(30)).toBe(195);
    expect(resolveAiJobProcessingTimeoutSeconds(NaN)).toBe(240);
    expect(resolveAiJobProcessingTimeoutSeconds(0)).toBe(240);
    expect(resolveAiJobProcessingTimeoutSeconds(600)).toBe(600);
  });
});
