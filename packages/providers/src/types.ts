import type {
  ProviderToolCallChunk,
  ProviderToolCallRequest,
} from "./tool-calls";
import type {
  ProviderReasoningParameters,
  ProviderStructuredOutput,
} from "./chat-parameter-types";
import type { ProviderReasoningPolicyLayers } from "./reasoning-policy";
import type {
  ProviderAudioAdapter,
  ProviderBatchesAdapter,
  ProviderFilesAdapter,
  ProviderTokenCountingAdapter,
} from "./provider-operation-types";

export type * from "./provider-operation-types";
export type * from "./chat-parameter-types";
export type * from "./reasoning-policy";

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
  temperature?: boolean;
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

export interface ModelDefaultParameters {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
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
  defaultParameters?: ModelDefaultParameters;
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
  reasoning?: ProviderReasoningParameters;
  reasoningPolicy?: ProviderReasoningPolicyLayers;
  sampling?: ProviderSampling;
  signal?: AbortSignal;
  structuredOutput?: ProviderStructuredOutput;
  tools?: ProviderToolDefinition[];
}

export interface ProviderTokenUsage {
  /** Provider-reported prompt/input tokens. */
  inputTokens?: number;
  /** Reported subset of inputTokens served from a provider cache. */
  cachedInputTokens?: number;
  /** Provider-reported completion/output tokens, including reasoning when reported as a subset. */
  outputTokens?: number;
  /** Reported reasoning subset of outputTokens; never an additional billable total. */
  reasoningTokens?: number;
  /** Provider-reported total only. Locally derived sums must not populate this field. */
  totalTokens?: number;
  /** Trusted adapter/dialect identifier, never an upstream response value. */
  source?: string;
}

export type StreamChatChunk =
  | string
  | ProviderToolCallChunk
  /** @deprecated Unclassified provider reasoning is private and must be discarded. */
  | { type: "reasoning"; text: string }
  | { type: "reasoning_summary"; text: string }
  | { type: "usage"; usage: ProviderTokenUsage };

export interface ProviderHealthAdapter {
  kind: ProviderKind;
  health(
    provider: ProviderInstance,
    options?: { apiKey?: string; fetchImpl?: typeof fetch },
  ): Promise<{ ok: boolean; message: string }>;
}

export interface ProviderDiscoveryAdapter {
  kind: ProviderKind;
  listModels(
    provider: ProviderInstance,
    options?: {
      apiKey?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    },
  ): Promise<BaseModel[]>;
}

export interface ProviderChatAdapter {
  kind: ProviderKind;
  streamChat(input: StreamChatInput): AsyncIterable<StreamChatChunk>;
}

/**
 * Compatibility aggregate for callers that still resolve the original
 * all-current-provider adapter. New dialect operations should depend on the
 * focused interfaces above instead.
 */
export interface ModelProviderAdapter
  extends
    ProviderHealthAdapter,
    ProviderDiscoveryAdapter,
    ProviderChatAdapter {}

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

export interface ProviderEmbeddingsAdapter {
  kind: ProviderKind;
  embedTexts(input: EmbedTextsInput): Promise<EmbedTextsResult>;
}

/** @deprecated Prefer ProviderEmbeddingsAdapter. */
export type EmbeddingProviderAdapter = ProviderEmbeddingsAdapter;

export type ProviderImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface GenerateProviderImagesInput {
  apiKey?: string;
  count: number;
  fetchImpl?: typeof fetch;
  idempotencyKey?: string;
  model: string;
  prompt: string;
  provider: Pick<ProviderInstance, "baseUrl">;
  signal?: AbortSignal;
  size: ProviderImageSize;
}

export interface GeneratedProviderImage {
  b64Json?: string;
  revisedPrompt?: string;
}

export interface ProviderImageAdapter {
  kind: ProviderKind;
  generate(
    input: GenerateProviderImagesInput,
  ): Promise<GeneratedProviderImage[]>;
}

/** @deprecated Prefer ProviderImageAdapter. */
export type ImageGenerationProviderAdapter = ProviderImageAdapter;

export type ProviderCapabilityProbeName =
  | "audio-input"
  | "reasoning"
  | "streaming"
  | "structured-json"
  | "tool-calling"
  | "vision";

export interface ProbeProviderCapabilitiesInput {
  apiKey?: string;
  capabilities: readonly ProviderCapabilityProbeName[];
  fetchImpl?: typeof fetch;
  model: BaseModel;
  provider: ProviderInstance;
  signal?: AbortSignal;
}

export interface ProviderCapabilityProbeResult {
  capability: ProviderCapabilityProbeName;
  detail?: string;
  supported: boolean;
}

export interface ProviderCapabilityProbeAdapter {
  kind: ProviderKind;
  probeCapabilities(
    input: ProbeProviderCapabilitiesInput,
  ): Promise<readonly ProviderCapabilityProbeResult[]>;
}

export type ProviderErrorCategory =
  | "auth"
  | "cancelled"
  | "invalid_request_or_capability"
  | "policy"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "unexpected";

export type ProviderNormalizedErrorCode =
  | "provider_authentication_failed"
  | "provider_invalid_request_or_capability"
  | "provider_policy_rejected"
  | "provider_quota_exceeded"
  | "provider_rate_limited"
  | "provider_request_cancelled"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_unexpected_failure";

export interface ProviderErrorContext {
  operation: ProviderRequestOperation;
}

export interface ProviderNormalizedError {
  category: ProviderErrorCategory;
  code: ProviderNormalizedErrorCode;
  errorCode: ProviderNormalizedErrorCode;
  errorType: ProviderErrorCategory;
  kind: ProviderKind;
  operation: ProviderRequestOperation;
  retryable: boolean;
  safeMessage: string;
  status?: number;
}

export interface ProviderErrorNormalizer {
  kind: ProviderKind;
  normalizeError(
    error: unknown,
    context: ProviderErrorContext,
  ): ProviderNormalizedError;
}

export interface ProviderUsageParser {
  kind: ProviderKind;
  parseUsage(
    payload: unknown,
    previous?: ProviderTokenUsage,
  ): ProviderTokenUsage | undefined;
}

export const PROVIDER_DIALECT_CONTRACT_VERSION = "1" as const;
export type ProviderDialectContractVersion =
  typeof PROVIDER_DIALECT_CONTRACT_VERSION;

/**
 * A provider dialect is a static description of the protocol surfaces Romeo
 * can actually invoke for one configured provider kind. Optional operations
 * are intentionally absent rather than represented by optimistic booleans.
 */
export interface ProviderDialect {
  readonly audio?: Readonly<ProviderAudioAdapter>;
  readonly batches?: Readonly<ProviderBatchesAdapter>;
  readonly capabilityProbing?: Readonly<ProviderCapabilityProbeAdapter>;
  readonly chat: Readonly<ProviderChatAdapter>;
  readonly contractVersion: ProviderDialectContractVersion;
  readonly discovery: Readonly<ProviderDiscoveryAdapter>;
  readonly embeddings?: Readonly<ProviderEmbeddingsAdapter>;
  readonly errorNormalization?: Readonly<ProviderErrorNormalizer>;
  readonly files?: Readonly<ProviderFilesAdapter>;
  readonly imageGeneration?: Readonly<ProviderImageAdapter>;
  readonly kind: ProviderKind;
  readonly tokenCounting?: Readonly<ProviderTokenCountingAdapter>;
  readonly usageParsing?: Readonly<ProviderUsageParser>;
  readonly version: string;
}

export type ProviderDialectOperation =
  | "audio"
  | "batches"
  | "capabilityProbing"
  | "chat"
  | "discovery"
  | "embeddings"
  | "errorNormalization"
  | "files"
  | "imageGeneration"
  | "tokenCounting"
  | "usageParsing";

export type ProviderRequestOperation =
  | ProviderDialectOperation
  | "health"
  | "modelManagement";

export type ProviderDialectOperations = Readonly<
  Record<ProviderDialectOperation, boolean>
>;

export interface ProviderDialectSummary {
  readonly contractVersion: ProviderDialectContractVersion;
  readonly kind: ProviderKind;
  readonly operations: ProviderDialectOperations & {
    readonly chat: true;
    readonly discovery: true;
  };
  readonly version: string;
}
