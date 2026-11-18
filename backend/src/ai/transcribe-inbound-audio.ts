import OpenAI from "openai";
import { toFile } from "openai";
import { config } from "../config.js";
import { TRANSCRIPTION_FALLBACK_MODEL, TRANSCRIPTION_MODEL } from "./models.js";
import { getBase64FromMediaMessage } from "../integrations/whatsapp/evolution-client.js";

export const AUDIO_FAIL_REPLY = "Não consegui ouvir o áudio — pode escrever?";

export type TranscribeInboundAudioResult = { ok: true; text: string } | { ok: false; error: string };

async function transcribeWithFallback(openai: OpenAI, file: File): Promise<string> {
  try {
    // O gpt-transcribe usa languages no lugar de language; o tipo do SDK ainda não traz esse campo.
    const body = { file, model: TRANSCRIPTION_MODEL, languages: ["pt"] };
    const out = await openai.audio.transcriptions.create(
      body as unknown as OpenAI.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming,
    );
    return out.text ?? "";
  } catch {
    const out = await openai.audio.transcriptions.create({
      file,
      model: TRANSCRIPTION_FALLBACK_MODEL,
      language: "pt",
    });
    return out.text ?? "";
  }
}

export async function transcribeInboundAudio(params: {
  instanceName: string;
  providerEventId: string;
  openai?: OpenAI;
  fetchMedia?: (instanceName: string, providerEventId: string) => Promise<{ base64: string; mimetype?: string }>;
  transcribe?: (file: File) => Promise<string>;
}): Promise<TranscribeInboundAudioResult> {
  try {
    const fetchMedia = params.fetchMedia ?? getBase64FromMediaMessage;
    const media = await fetchMedia(params.instanceName, params.providerEventId);
    const buf = Buffer.from(media.base64, "base64");
    if (!buf.length) return { ok: false, error: "empty_audio" };
    const mime = (media.mimetype ?? "audio/ogg").split(";")[0] || "audio/ogg";
    const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("mp4") ? "mp4" : "ogg";
    const file = await toFile(buf, `inbound.${ext}`, { type: mime });
    if (params.transcribe) {
      const text = (await params.transcribe(file)).trim();
      return text ? { ok: true, text } : { ok: false, error: "empty_transcript" };
    }
    const openai = params.openai ?? (config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null);
    if (!openai) return { ok: false, error: "openai_missing" };
    const text = (await transcribeWithFallback(openai, file)).trim();
    return text ? { ok: true, text } : { ok: false, error: "empty_transcript" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "transcribe_failed" };
  }
}
