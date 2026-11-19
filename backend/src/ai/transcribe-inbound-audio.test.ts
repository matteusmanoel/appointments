import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { transcribeInboundAudio } from "./transcribe-inbound-audio.js";

const fetchMedia = async () => ({ base64: Buffer.from("audio").toString("base64"), mimetype: "audio/ogg; codecs=opus" });
const clientWith = (create: ReturnType<typeof vi.fn>) =>
  ({ audio: { transcriptions: { create } } }) as unknown as OpenAI;

describe("transcribeInboundAudio", () => {
  it("usa gpt-transcribe com languages", async () => {
    const create = vi.fn().mockResolvedValue({ text: " quero marcar " });
    const result = await transcribeInboundAudio({
      instanceName: "i",
      providerEventId: "e",
      fetchMedia,
      openai: clientWith(create),
    });
    expect(result).toEqual({ ok: true, text: "quero marcar" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ model: "gpt-transcribe", languages: ["pt"] });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("language");
  });

  it("recorre ao whisper-1 quando o gpt-transcribe recusa o áudio", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("unsupported")).mockResolvedValue({ text: "pode ser" });
    const result = await transcribeInboundAudio({
      instanceName: "i",
      providerEventId: "e",
      fetchMedia,
      openai: clientWith(create),
    });
    expect(result).toEqual({ ok: true, text: "pode ser" });
    expect(create.mock.calls[1]![0]).toMatchObject({ model: "whisper-1", language: "pt" });
  });

  it("devolve erro quando os dois modelos falham", async () => {
    const create = vi.fn().mockRejectedValue(new Error("fora do ar"));
    const result = await transcribeInboundAudio({
      instanceName: "i",
      providerEventId: "e",
      fetchMedia,
      openai: clientWith(create),
    });
    expect(result).toEqual({ ok: false, error: "fora do ar" });
  });
});
