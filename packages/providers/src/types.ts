import type {
  ProviderToolCallChunk,
  ProviderToolCallRequest,
} from "./tool-calls";

export type ProviderKind =
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
  modalities: ModelModality[];
  deployment: ProviderDeploymentConstraints;
}

export interface ModelPricing {
  inputTokenUsd: number;
  outputTokenUsd: number;
}

export interface ProviderInstance {
  id: string;
  orgId: string;
  type: ProviderKind;
  name: string;
  baseUrl: string;
  credentialRef?: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
}

export interface BaseModel {
  id: string;
  providerId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  pricing?: ModelPricing;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
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

export interface StreamChatInput {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  provider: ProviderInstance;
  model: BaseModel;
  messages: ChatMessage[];
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
  | { type: "usage"; usage: ProviderTokenUsage };

export interface ModelProviderAdapter {
  kind: ProviderKind;
  health(provider: ProviderInstance): Promise<{ ok: boolean; message: string }>;
  listModels(provider: ProviderInstance): Promise<BaseModel[]>;
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
