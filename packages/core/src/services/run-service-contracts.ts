import type { AuthSubject } from "@romeo/auth";
import type {
  BaseModel,
  ChatMessage,
  ProviderInstance,
  ProviderToolDefinition,
} from "@romeo/providers";
import type { RetrievalHit } from "@romeo/rag";

import type { Message, MessagePart, RunRecord } from "../domain/entities";
import type { FileMalwareScanner, FileMalwareScanPolicy } from "./file-service";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";
import type { ChatAttachmentInput } from "./message-attachments";
import type { ProviderRoutePlan } from "./provider-routing";
import type { QuotaCoordinator } from "./quota-coordination";
import type {
  RunKnowledgeCitation,
  RunKnowledgeSafetySummary,
} from "./run-knowledge";
import type { SecretResolver } from "./secret-resolver";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

export interface RunServiceOptions {
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
    query: string;
    search: boolean;
    urls: string[];
  }) => Promise<RetrievalHit[]>;
}

export interface DeferredRunStart {
  run: RunRecord;
  startExecution(): void;
}

export interface StartRunInput {
  attachments?: ChatAttachmentInput[];
  fileIds?: string[];
  subject: AuthSubject;
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
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
  run: Omit<RunRecord, "createdBy">;
  userMessage: Message;
}
