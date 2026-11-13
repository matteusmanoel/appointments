import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tf = (f: string) => readFileSync(resolve(here, "../../../infra/production", f), "utf8");
const main = tf("main.tf");
const sqs = tf("sqs.tf");
const locals = tf("locals.tf");
const FUNCS = ["api", "worker_ai", "worker_scheduled", "worker_knowledge"];

function lambdaBlock(name: string): string {
  const i = main.indexOf(`resource "aws_lambda_function" "${name}"`);
  expect(i).toBeGreaterThan(-1);
  return main.slice(i, main.indexOf("\n}\n", i));
}

describe("Terraform: trava contra apply com placeholder", () => {
  it.each(FUNCS)("%s usa o zip dela e tem precondition contra placeholder", (fn) => {
    const b = lambdaBlock(fn);
    expect(b).toContain(`local.lambda_zip["${fn}"]`);
    expect(b).toContain(`local.lambda_hash["${fn}"]`);
    expect(b).toMatch(/precondition\s*{[^}]*local\.lambda_is_real\["/s);
    expect(b).toContain("var.allow_placeholder_deploy");
  });
  it("allow_placeholder_deploy é false por padrão", () => {
    expect(tf("variables-lambda-zips.tf")).toMatch(/variable "allow_placeholder_deploy"[\s\S]*?default\s*=\s*false/);
  });
  it("locals resolvem zip por função com fallback no zip legado", () => {
    expect(locals).toMatch(/lookup\(var\.lambda_zip_paths, fn, var\.lambda_zip_path\)/);
  });
});

describe("Terraform: SQS", () => {
  it("fila com DLQ (maxReceiveCount) e visibilidade >= 6x o timeout do worker_ai (180s)", () => {
    expect(sqs).toMatch(/maxReceiveCount\s*=\s*3/);
    const vis = Number(/visibility_timeout_seconds\s*=\s*(\d+)/.exec(sqs)?.[1]);
    expect(vis).toBeGreaterThanOrEqual(6 * 180);
  });
  it("event source mapping no worker_ai com ReportBatchItemFailures e concorrência limitada", () => {
    expect(sqs).toMatch(/aws_lambda_event_source_mapping" "worker_ai_sqs"[\s\S]*aws_lambda_function\.worker_ai\.arn/);
    expect(sqs).toContain("ReportBatchItemFailures");
    expect(sqs).toContain("maximum_concurrency");
  });
  it("IAM mínimo: worker só consome, API só envia, sempre na ARN da fila (sem * )", () => {
    expect(sqs).toMatch(/"sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"/);
    expect(sqs).toMatch(/Action\s*=\s*\["sqs:SendMessage"\]/);
    expect(sqs).not.toMatch(/sqs:\*/);
    expect(sqs).not.toMatch(/Resource\s*=\s*"\*"/);
  });
  it("API recebe AI_JOBS_QUEUE_URL", () => {
    expect(main).toContain("AI_JOBS_QUEUE_URL = aws_sqs_queue.ai_jobs.url");
  });
});
