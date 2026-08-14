import type { AuthSubject } from "@romeo/auth";
import type {
  BaseModel,
  ChatMessage,
  ProviderInstance,
  ProviderReasoningParameters,
  ProviderReasoningPolicy,
  ProviderReasoningPolicyLayers,
  ProviderSampling,
  ProviderStructuredOutput,
  ProviderToolDefinition,
} from "@romeo/providers";
import type { RetrievalHit } from "@romeo/rag";

import type { Message, MessagePart, RunRecord } from "../domain/entities";
import type { FileMalwareScanner, FileMalwareScanPolicy } from "./file-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import type { ChatAttachmentInput } from "./message-attachments";
import type { ProviderRoutePlan } from "./provider-routing";
import type { ModelRoutingDecision, ModelRoutingMode } from "./model-routing";
import type { QuotaCoordinator } from "./quota-coordination";
import type {
  RunKnowledgeCitation,
  RunKnowledgeSafetySummary,
} from "./run-knowledge";
import type { SecretResolver } from "./secret-resolver";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";

export interface RunServiceOptions {
  capabilityPlatformPolicy?: CapabilityPlatformPolicy;
  managedModelPreferenceEncryptionKey?: string;
  managedModelPreferencePreviousEncryptionKey?: string;
  modelToolExecutor?: (input: {
    subject: AuthSubject;
    runId: string;
    toolId: string;
    input: unknown;
    modelToolCallId: string;
  }) => Promise<unknown>;
  providerDisabledIds?: string;
  providerCircuitCooldownMs?: number;
  providerCircuitFailureThreshold?: number;
  providerFallbackModelId?: string;
  providerRetryAttempts?: number;
  providerRetryBackoffMs?: number;
  providerFetch?: typeof fetch;
  providerStreamTimeoutMs?: number;
  runExecutionLeaseSeconds?: number;
  runRecoveryStaleMs?: number;
  /** Bounded cadence for revalidating the principal and ACL of an open run stream. */
  runStreamAuthorizationRecheckMs?: number;
  secretResolver?: SecretResolver;
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  knowledgeVectorStore?: KnowledgeVectorStore;
  messageAttachmentMaxBytes?: number;
  malwareScanning?: {
    policy: FileMalwareScanPolicy;
    scanner?: FileMalwareScanner;
  };
  quotaCoordinator?: QuotaCoordinator | undefined;
  toolOperationExecutionEnabled?: boolean;
  webRetrieval?: (input: {
    subject: AuthSubject;
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    query: string;
    search: boolean;
    urls: string[];
  }) => Promise<RetrievalHit[]>;
}

export interface DeferredRunStart {
  inputMessageId: string;
  run: RunRecord;
  startExecution(): void;
}

export interface StartedRunRecord extends RunRecord {
  inputMessageId: string;
}

export interface StartRunInput {
  attachments?: ChatAttachmentInput[];
  fileIds?: string[];
  subject: AuthSubject;
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
  /** Governed, capability-preserving model selection for this turn. */
  routingMode?: ModelRoutingMode;
  /** Evidence-first multi-source retrieval and citation instructions. */
  researchMode?: "standard" | "deep";
  /** Optional version-one per-run reasoning request, constrained again at dispatch. */
  reasoningPolicy?: ProviderReasoningPolicy;
  /**
   * User-message boundary excluded from replay. Regeneration uses the message
   * being replaced; ordinary turns omit it to include the full chat history.
   */
  historyBoundaryMessageId?: string;
  /**
   * Attaches the new turn under an existing message instead of extending the
   * active branch: `null` forks from the chat root (needed to re-answer the
   * first turn), absent extends `chat.activeLeafMessageId` so ordinary sends
   * stay linear.
   */
  parentMessageId?: string | null;
  webSearch?: boolean;
  urls?: string[];
  /**
   * Optional per-turn knowledge bases. When set, overrides the agent bindings
   * for retrieval (subject to grants and org RAG policy). Empty disables RAG.
   */
  knowledgeBaseIds?: string[];
  agenticRag?: boolean;
}

export interface PreparedRunStart {
  agentId: string;
  agentVersionId: string;
  citations: RunKnowledgeCitation[];
  estimatedInputTokens: number;
  historyMessages: number;
  historyTruncated: boolean;
  input: {
    content: string;
    subject: AuthSubject;
  };
  knowledgeHitsDropped: number;
  knowledgeSafety?: RunKnowledgeSafetySummary;
  messageParts: MessagePart[];
  messages: ChatMessage[];
  model: BaseModel;
  provider: ProviderInstance;
  providerTools: ProviderToolDefinition[];
  quotaTarget: {
    model: BaseModel;
    provider: ProviderInstance;
  };
  routePlan: ProviderRoutePlan;
  routingDecision: ModelRoutingDecision;
  run: Omit<RunRecord, "createdBy">;
  /** Sampling requested by the agent version; the selected adapter narrows it before dispatch. */
  sampling?: ProviderSampling;
  reasoning?: ProviderReasoningParameters;
  reasoningPolicy?: ProviderReasoningPolicyLayers;
  structuredOutput?: ProviderStructuredOutput;
  userMessage: Message;
}
