import OpenAI, { toFile } from "openai";

import type {
  SpeechRequest,
  SpeechSynthesisArtifact,
  TranscriptionRequest,
  TranscriptionResult,
  VoiceProfile,
  VoiceProvider,
} from "./types";

export interface OpenAICompatibleVoiceDefinition {
  id: string;
  name?: string;
  language?: string;
  styleTags?: string[];
}

export interface OpenAICompatibleVoiceProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  transcriptionModel?: string;
  voices?: OpenAICompatibleVoiceDefinition[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleVoiceProvider implements VoiceProvider {
  private readonly timeoutMs: number;
  private readonly voices: OpenAICompatibleVoiceDefinition[];

  constructor(private readonly options: OpenAICompatibleVoiceProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.voices = options.voices ?? [];
  }

  async listVoices(orgId: string): Promise<VoiceProfile[]> {
    return this.voices.map((voice) => ({
      id: `openai_voice_${safeProfilePart(orgId)}_${safeProfilePart(voice.id)}`,
      providerId: "voice_openai_compatible",
      providerVoiceId: voice.id,
      name: voice.name ?? voice.id,
      language: voice.language ?? "en",
      styleTags: voice.styleTags ?? ["openai-compatible"],
      cloningAllowed: false,
    }));
  }

  async synthesize(request: SpeechRequest): Promise<SpeechSynthesisArtifact> {
    if (
      this.options.apiKey.length === 0 ||
      this.options.model.length === 0 ||
      this.options.baseUrl.length === 0
    ) {
      throw new Error("OpenAI-compatible voice provider is not configured.");
    }

    try {
      const response = await this.client().audio.speech.create({
        model: this.options.model,
        voice: request.voiceId,
        input: request.text,
        response_format: request.format === "ogg" ? "opus" : request.format,
      });

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0)
        throw new Error("Voice synthesis returned an empty artifact.");

      const id = crypto.randomUUID();
      const contentType = audioContentType(
        response.headers.get("content-type"),
        request.format,
      );
      return {
        id,
        contentType,
        storageKey: `openai-voice/${safeProfilePart(request.orgId)}/${safeProfilePart(request.voiceId)}/${id}.${extensionForFormat(request.format)}`,
        body: bytes,
      };
    } catch (caught) {
      if (isTimeoutError(caught)) throw new Error("Voice synthesis timed out.");
      throw caught;
    }
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    const model = this.options.transcriptionModel ?? "whisper-1";
    if (
      this.options.apiKey.length === 0 ||
      model.length === 0 ||
      this.options.baseUrl.length === 0
    ) {
      throw new Error(
        "OpenAI-compatible voice transcription provider is not configured.",
      );
    }

    const file = await toFile(
      request.audio,
      safeFileName(request.fileName, request.contentType),
      {
        type: request.contentType,
      },
    );

    try {
      const payload = await this.client().audio.transcriptions.create({
        model,
        file,
        response_format: "verbose_json",
        ...(request.language === undefined
          ? {}
          : { language: request.language }),
        ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
      });
      const text = payload.text.trim();
      if (text.length === 0)
        throw new Error("Voice transcription returned empty text.");
      const language =
        typeof payload.language === "string" && payload.language.length > 0
          ? payload.language
          : request.language;
      const durationMs =
        typeof payload.duration === "number" &&
        Number.isFinite(payload.duration)
          ? Math.max(0, Math.round(payload.duration * 1000))
          : undefined;
      return {
        text,
        ...(language === undefined ? {} : { language }),
        ...(durationMs === undefined ? {} : { durationMs }),
      };
    } catch (caught) {
      if (isTimeoutError(caught))
        throw new Error("Voice transcription timed out.");
      throw caught;
    }
  }

  private client(): OpenAI {
    return new OpenAI({
      apiKey: this.options.apiKey,
      baseURL: validatedBaseUrl(this.options.baseUrl),
      fetch: this.options.fetchImpl,
      maxRetries: 0,
      timeout: this.timeoutMs,
    });
  }
}

export function parseOpenAICompatibleVoiceCatalog(
  value: string,
): OpenAICompatibleVoiceDefinition[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [id, name] = item.split("=");
      const voiceId = id?.trim() ?? "";
      return {
        id: voiceId,
        ...(name === undefined || name.trim().length === 0
          ? {}
          : { name: name.trim() }),
      };
    })
    .filter((voice) => /^[A-Za-z0-9_-]+$/u.test(voice.id));
}

function validatedBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "OpenAI-compatible voice base URL must be an http(s) origin or versioned API path without credentials, query, or fragment.",
    );
  }
  if (url.protocol === "http:" && !isLocalHostname(url.hostname))
    throw new Error(
      "OpenAI-compatible voice base URL must use HTTPS outside localhost.",
    );
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function isTimeoutError(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    (caught.name === "AbortError" ||
      caught.name === "APIConnectionTimeoutError")
  );
}

function audioContentType(
  contentType: string | null,
  format: SpeechRequest["format"],
): string {
  if (contentType?.startsWith("audio/") === true)
    return contentType.split(";")[0] ?? contentType;
  if (format === "mp3") return "audio/mpeg";
  if (format === "ogg") return "audio/ogg";
  return "audio/wav";
}

function extensionForFormat(format: SpeechRequest["format"]): string {
  return format === "mp3" ? "mp3" : format === "ogg" ? "ogg" : "wav";
}

function safeProfilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80);
}

function safeFileName(
  fileName: string | undefined,
  contentType: string,
): string {
  const candidate = fileName?.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 120);
  if (candidate !== undefined && candidate.length > 0) return candidate;
  if (contentType === "audio/mpeg") return "audio.mp3";
  if (contentType === "audio/ogg") return "audio.ogg";
  if (contentType === "audio/webm") return "audio.webm";
  if (contentType === "audio/mp4" || contentType === "video/mp4")
    return "audio.mp4";
  return "audio.wav";
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}
