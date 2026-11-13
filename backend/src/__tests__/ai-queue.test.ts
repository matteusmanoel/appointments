import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyAiJobScheduled, clampSqsDelaySeconds, __setSqsClientFactoryForTests } from "../queue/ai-queue.js";

afterEach(() => __setSqsClientFactoryForTests(null));

describe("notifyAiJobScheduled (gatilho por evento)", () => {
  it("sem AI_JOBS_QUEUE_URL não faz nada (comportamento antigo: EventBridge)", async () => {
    const send = vi.fn();
    __setSqsClientFactoryForTests(() => ({ send }) as never);
    expect(await notifyAiJobScheduled(8, {}, {})).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("envia mensagem com DelaySeconds = janela de silêncio (debounce)", async () => {
    const send = vi.fn(async (_cmd: unknown) => ({}));
    __setSqsClientFactoryForTests(() => ({ send }) as never);
    const ok = await notifyAiJobScheduled(8, { barbershopId: "b1", conversationId: "c1" }, { AI_JOBS_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/1/q" });
    expect(ok).toBe(true);
    const cmd = send.mock.calls[0]![0] as { input: { QueueUrl: string; DelaySeconds: number; MessageBody: string } };
    expect(cmd.input.QueueUrl).toContain("sqs.us-east-2");
    expect(cmd.input.DelaySeconds).toBe(8);
    expect(JSON.parse(cmd.input.MessageBody)).toMatchObject({ type: "ai_job_scheduled", barbershopId: "b1" });
  });

  it("nunca lança: falha do SQS devolve false (o webhook segue)", async () => {
    __setSqsClientFactoryForTests(() => ({ send: vi.fn(async () => { throw new Error("AccessDenied"); }) }) as never);
    await expect(notifyAiJobScheduled(8, {}, { AI_JOBS_QUEUE_URL: "https://q" })).resolves.toBe(false);
  });

  it("respeita o teto de 900 s do SQS", () => {
    expect(clampSqsDelaySeconds(5000)).toBe(900);
    expect(clampSqsDelaySeconds(-1)).toBe(0);
    expect(clampSqsDelaySeconds(NaN)).toBe(0);
    expect(clampSqsDelaySeconds(8.9)).toBe(8);
  });
});
