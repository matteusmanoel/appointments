import { describe, it, expect } from "vitest";
import { AUDIO_FAIL_REPLY, transcribeInboundAudio } from "../ai/transcribe-inbound-audio.js";

describe("transcribeInboundAudio", () => {
  it("returns the transcript when media + whisper succeed", async () => {
    const r = await transcribeInboundAudio({
      instanceName: "nh-abc",
      providerEventId: "wamid.audio",
      fetchMedia: async () => ({ base64: Buffer.from("ogg-bytes").toString("base64"), mimetype: "audio/ogg" }),
      transcribe: async () => "quero reagendar",
    });
    expect(r).toEqual({ ok: true, text: "quero reagendar" });
  });

  it("fails honestly when there is no audio payload", async () => {
    const r = await transcribeInboundAudio({
      instanceName: "nh-abc",
      providerEventId: "wamid.audio",
      fetchMedia: async () => ({ base64: "", mimetype: "audio/ogg" }),
    });
    expect(r.ok).toBe(false);
    expect(AUDIO_FAIL_REPLY).toMatch(/áudio/);
  });
});
