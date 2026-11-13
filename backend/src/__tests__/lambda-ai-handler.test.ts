import { describe, it, expect, vi } from "vitest";

const runAiWorkerCycle = vi.fn();
vi.mock("../workers/ai-worker.js", () => ({ runAiWorkerCycle: (...a: unknown[]) => runAiWorkerCycle(...a) }));

import { handler } from "../workers/lambda-ai.js";

const sqsEvent = { Records: [{ eventSource: "aws:sqs", messageId: "m1" }, { eventSource: "aws:sqs", messageId: "m2" }] };

describe("lambda-ai handler (SQS + EventBridge)", () => {
  it("EventBridge: devolve statusCode/body como antes", async () => {
    runAiWorkerCycle.mockResolvedValueOnce({ processed: 2 });
    expect(await handler({} as never)).toEqual({ statusCode: 200, body: JSON.stringify({ processed: 2 }) });
  });
  it("SQS: um ciclo atende o lote inteiro e não devolve falhas", async () => {
    runAiWorkerCycle.mockClear();
    runAiWorkerCycle.mockResolvedValueOnce({ processed: 1 });
    expect(await handler(sqsEvent)).toEqual({ batchItemFailures: [] });
    expect(runAiWorkerCycle).toHaveBeenCalledTimes(1);
  });
  it("SQS: erro devolve as mensagens à fila (retry → DLQ)", async () => {
    runAiWorkerCycle.mockRejectedValueOnce(new Error("boom"));
    const r = (await handler(sqsEvent)) as { batchItemFailures: { itemIdentifier: string }[] };
    expect(r.batchItemFailures.map((x) => x.itemIdentifier)).toEqual(["m1", "m2"]);
  });
  it("EventBridge: erro vira 500", async () => {
    runAiWorkerCycle.mockRejectedValueOnce(new Error("boom"));
    expect(await handler(undefined)).toMatchObject({ statusCode: 500 });
  });
});
