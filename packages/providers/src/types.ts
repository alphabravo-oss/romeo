import type {
  ProviderToolCallChunk,
  ProviderToolCallRequest,
} from "./tool-calls";

export type ProviderKind =
  | "anthropic"
  | "openai-compatible"
  | "openai-responses-compatible"
  | "ollama";
export type ModelModality =
  | "audio-input"
  | "audio-output"
  | "embeddings"
  | "text"
  | "vision";
export type ProviderDeploymentMode = "hosted-api" | "local-runtime";
export type ProviderNetworkAccess = "external-http" | "local-http";

export interface ProviderDeploymentConstraints {
  mode: ProviderDeploymentMode;
  networkAccess: ProviderNetworkAccess;
  credentialRequired: boolean;
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  audioInput: boolean;
  structuredJson: boolean;
  reasoning: boolean;
  imageGeneration?: boolean;
  modalities: ModelModality[];
  deployment: ProviderDeploymentConstraints;
}

export interface ModelPricing {
  inputTokenUsd: number;
  outputTokenUsd: number;
  imageGenerationUsd?: {
    "1024x1024": number;
    "1024x1536": number;
    "1536x1024": number;
  };
}

export type ProviderCatalogSyncStatus =
  | "error"
  | "never"
  | "ready"
  | "stale"
  | "syncing";

export interface ProviderCatalogSyncState {
  status: ProviderCatalogSyncStatus;
  modelCount: number;
  lastAttemptAt?: string;
  lastSyncedAt?: string;
  error?: string;
}

export interface ProviderInstance {
  id: string;
  orgId: string;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
  modelIds?: string[];
  enabled: boolean;
  capabilities: ProviderCapabilities;
  catalogSync?: ProviderCatalogSyncState;
}

export interface BaseModel {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  available?: boolean;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  pricing?: ModelPricing;
  capabilitiesSource?: "detected" | "override";
}

export interface ProviderImageInput {
  dataBase64: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
}

export type ChatMessage =
  | {
      role: "system" | "user";
      content: string;
      images?: ProviderImageInput[];
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ProviderToolCallRequest[];
    }
  | {
      role: "tool";
      content: string;
      name?: string;
      toolCallId?: string;
    };

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * The sampling knobs a managed model version may pin. Deliberately three named numbers rather than
 * the open `AgentParameters` record it is derived from: that record allows arbitrary keys, and
 * forwarding an unrecognised one to a provider is how a saved preference turns into a 400.
 */
export interface ProviderSampling {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface StreamChatInput {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  provider: ProviderInstance;
  model: BaseModel;
  messages: ChatMessage[];
  sampling?: ProviderSampling;
  signal?: AbortSignal;
  tools?: ProviderToolDefinition[];
}

export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  source?: string;
}

export type StreamChatChunk =
  | string
  | ProviderToolCallChunk
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: ProviderTokenUsage };

export interface ModelProviderAdapter {
  kind: ProviderKind;
  health(
    provider: ProviderInstance,
    options?: { apiKey?: string; fetchImpl?: typeof fetch },
  ): Promise<{ ok: boolean; message: string }>;
  listModels(
    provider: ProviderInstance,
    options?: {
      apiKey?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    },
  ): Promise<BaseModel[]>;
  streamChat(input: StreamChatInput): AsyncIterable<StreamChatChunk>;
}

export interface EmbedTextsInput {
  provider: ProviderInstance;
  model: string;
  texts: string[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface EmbedTextsResult {
  model: string;
  dimensions: number;
  embeddings: number[][];
  usage?: ProviderTokenUsage;
}

export interface EmbeddingProviderAdapter {
  kind: ProviderKind;
  embedTexts(input: EmbedTextsInput): Promise<EmbedTextsResult>;
}
