import type {
  ChatMessage,
  ProviderInstance,
  ProviderKind,
  ProviderTokenUsage,
} from "./types";

export type ProviderAudioMediaType =
  | "audio/aac"
  | "audio/flac"
  | "audio/mpeg"
  | "audio/ogg"
  | "audio/wav"
  | "audio/webm";

export interface TranscribeProviderAudioInput {
  apiKey?: string;
  audio: Uint8Array;
  fetchImpl?: typeof fetch;
  language?: string;
  mediaType: ProviderAudioMediaType;
  model: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
}

export interface ProviderAudioTranscript {
  durationMs?: number;
  language?: string;
  text: string;
  usage?: ProviderTokenUsage;
}

export interface SynthesizeProviderSpeechInput {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
  text: string;
  voice: string;
}

export interface ProviderSpeechAudio {
  audio: Uint8Array;
  mediaType: ProviderAudioMediaType;
  usage?: ProviderTokenUsage;
}

export interface ProviderAudioAdapter {
  kind: ProviderKind;
  synthesizeSpeech(
    input: SynthesizeProviderSpeechInput,
  ): Promise<ProviderSpeechAudio>;
  transcribeAudio(
    input: TranscribeProviderAudioInput,
  ): Promise<ProviderAudioTranscript>;
}

export interface ProviderFile {
  bytes: number;
  createdAt?: string;
  filename: string;
  id: string;
  mediaType?: string;
  purpose?: string;
}

export interface UploadProviderFileInput {
  apiKey?: string;
  content: Uint8Array;
  fetchImpl?: typeof fetch;
  filename: string;
  mediaType?: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  purpose?: string;
  signal?: AbortSignal;
}

export interface ProviderFileOperationInput {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  fileId: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
}

export interface RetrievedProviderFile {
  content: Uint8Array;
  file: ProviderFile;
}

export interface ProviderFilesAdapter {
  kind: ProviderKind;
  deleteFile(input: ProviderFileOperationInput): Promise<{ deleted: boolean }>;
  retrieveFile(
    input: ProviderFileOperationInput,
  ): Promise<RetrievedProviderFile>;
  uploadFile(input: UploadProviderFileInput): Promise<ProviderFile>;
}

export type ProviderBatchOperation = "chat" | "embeddings";

export interface ProviderBatchRequest {
  customId: string;
  input: Readonly<Record<string, unknown>>;
  operation: ProviderBatchOperation;
}

export interface CreateProviderBatchInput {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  provider: Pick<ProviderInstance, "baseUrl">;
  requests: readonly ProviderBatchRequest[];
  signal?: AbortSignal;
}

export type ProviderBatchStatus =
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "in_progress"
  | "queued";

export interface ProviderBatch {
  completedRequests?: number;
  failedRequests?: number;
  id: string;
  status: ProviderBatchStatus;
  totalRequests: number;
}

export interface ProviderBatchOperationInput {
  apiKey?: string;
  batchId: string;
  fetchImpl?: typeof fetch;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
}

export interface ProviderBatchesAdapter {
  kind: ProviderKind;
  cancelBatch(input: ProviderBatchOperationInput): Promise<ProviderBatch>;
  createBatch(input: CreateProviderBatchInput): Promise<ProviderBatch>;
  getBatch(input: ProviderBatchOperationInput): Promise<ProviderBatch>;
}

export interface CountProviderTokensInput {
  apiKey?: string;
  content: string | readonly ChatMessage[];
  fetchImpl?: typeof fetch;
  model: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
}

export interface ProviderTokenCount {
  inputTokens: number;
}

export interface ProviderTokenCountingAdapter {
  kind: ProviderKind;
  countTokens(input: CountProviderTokensInput): Promise<ProviderTokenCount>;
}
