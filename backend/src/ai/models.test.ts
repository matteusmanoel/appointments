import { beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import {
  DEFAULT_CHAT_MODEL,
  createChatCompletion,
  resetChatModelMemoryForTests,
  resolveChatModel,
} from "./models.js";

function clientWith(create: ReturnType<typeof vi.fn>): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const completion = { choices: [] };

describe("resolveChatModel", () => {
  it.each(["gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-4o", "gpt-4-turbo", "", null, undefined])(
    "troca %s pelo modelo padrão",
    (model) => {
      expect(resolveChatModel(model)).toBe(DEFAULT_CHAT_MODEL);
    },
  );

  it("mantém um modelo atual escolhido", () => {
    expect(resolveChatModel("gpt-6.1-terra")).toBe("gpt-6.1-terra");
  });
});

describe("createChatCompletion", () => {
  beforeEach(() => resetChatModelMemoryForTests());

  it("envia reasoning_effort none no gpt-6-luna", async () => {
    const create = vi.fn().mockResolvedValue(completion);
    await createChatCompletion(clientWith(create), { model: "gpt-4o-mini", messages: [] });
    expect(create.mock.calls[0]![0]).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "none" });
  });

  it("não envia reasoning_effort em outro modelo", async () => {
    const create = vi.fn().mockResolvedValue(completion);
    await createChatCompletion(clientWith(create), { model: "gpt-6.1-terra", messages: [] });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning_effort");
  });

  it("repete sem temperature quando o modelo recusa e lembra da recusa", async () => {
    const refused = Object.assign(new Error("Unsupported parameter"), { status: 400, param: "temperature" });
    const create = vi.fn().mockRejectedValueOnce(refused).mockResolvedValue(completion);
    const client = clientWith(create);

    await createChatCompletion(client, { model: "gpt-6-luna", temperature: 0.3, messages: [] });
    await createChatCompletion(client, { model: "gpt-6-luna", temperature: 0.3, messages: [] });

    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1]![0]).not.toHaveProperty("temperature");
    expect(create.mock.calls[2]![0]).not.toHaveProperty("temperature");
  });

  it("não esconde outro erro da API", async () => {
    const failure = Object.assign(new Error("rate limit"), { status: 429 });
    const create = vi.fn().mockRejectedValue(failure);
    await expect(
      createChatCompletion(clientWith(create), { model: "gpt-6-luna", temperature: 0.3, messages: [] }),
    ).rejects.toBe(failure);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
