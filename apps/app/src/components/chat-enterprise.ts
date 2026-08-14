/**
 * Pure display/gating helpers for enterprise chat chrome (E1–E5).
 * Keep side-effect free so unit tests drive the same functions the UI uses.
 */

export interface ProvenanceInput {
  modelId?: string | undefined;
  modelDisplayName?: string | undefined;
  agentName?: string | undefined;
  toolCallCount?: number | undefined;
  citationCount?: number | undefined;
  webSearchUsed?: boolean | undefined;
}

export interface ProvenanceChip {
  kind: "model" | "agent" | "tools" | "knowledge" | "web";
  label: string;
}

/** Default/product names that must never appear as identity chrome. */
const GENERIC_CUSTOM_MODEL_NAMES = new Set([
  "romeo assistant",
  "custom model",
  "assistant",
  "default",
  "default assistant",
]);

export function isGenericCustomModelName(name: string | undefined): boolean {
  if (name === undefined) return true;
  const normalized = name.trim().toLowerCase();
  return normalized.length === 0 || GENERIC_CUSTOM_MODEL_NAMES.has(normalized);
}

/** Compact provenance chips for an assistant turn. */
export function buildProvenanceChips(input: ProvenanceInput): ProvenanceChip[] {
  const chips: ProvenanceChip[] = [];
  const model =
    input.modelDisplayName?.trim() ||
    (input.modelId !== undefined && input.modelId.trim().length > 0
      ? input.modelId.trim()
      : undefined);
  const custom =
    input.agentName !== undefined && !isGenericCustomModelName(input.agentName)
      ? input.agentName.trim()
      : undefined;
  if (custom !== undefined) chips.push({ kind: "model", label: custom });
  else if (model !== undefined) chips.push({ kind: "model", label: model });
  if ((input.toolCallCount ?? 0) > 0) {
    chips.push({
      kind: "tools",
      label: `Tools · ${input.toolCallCount}`,
    });
  }
  if ((input.citationCount ?? 0) > 0) {
    chips.push({
      kind: "knowledge",
      label: `Sources · ${input.citationCount}`,
    });
  }
  if (input.webSearchUsed === true) {
    chips.push({ kind: "web", label: "Web search" });
  }
  return chips;
}

export interface PolicyErrorCopy {
  title: string;
  body: string;
  nextStep: string;
  code: string;
}

const POLICY_MAP: Record<
  string,
  { title: string; body: string; nextStep: string }
> = {
  provider_stream_timeout: {
    title: "The model took too long to respond",
    body: "No first token arrived before the stream timeout.",
    nextStep: "Try again, switch model, or shorten the prompt.",
  },
  provider_stream_aborted: {
    title: "Response stopped",
    body: "The stream was interrupted before a full answer arrived.",
    nextStep: "Regenerate or send a follow-up to continue.",
  },
  run_cancelled: {
    title: "Response stopped",
    body: "This run was cancelled.",
    nextStep: "Send a new message when you are ready.",
  },
  provider_credential_unavailable: {
    title: "Provider credentials unavailable",
    body: "Romeo could not load credentials for this model provider.",
    nextStep: "Ask an admin to check provider configuration.",
  },
  provider_run_failed: {
    title: "The provider run failed",
    body: "The model provider returned an error for this turn.",
    nextStep: "Retry, pick another model, or contact support with the code.",
  },
  quota_exceeded: {
    title: "Quota exceeded",
    body: "This workspace or plan has no remaining quota for this action.",
    nextStep: "Wait for reset or ask an admin to raise the limit.",
  },
  tool_denied: {
    title: "Tool use was denied",
    body: "A required tool call was blocked by policy or approval.",
    nextStep: "Approve the tool if prompted, or ask an admin for access.",
  },
};

/** Map a run/error code to trusted, actionable guidance. */
export function policyErrorCopy(input: {
  code: string;
  message?: string | undefined;
}): PolicyErrorCopy {
  const code = input.code.trim() || "provider_run_failed";
  const mapped = POLICY_MAP[code] ?? {
    title: "Something went wrong",
    body: "The run ended without a usable reply.",
    nextStep: "Retry the turn or contact support with the error code.",
  };
  return {
    code,
    title: mapped.title,
    body: mapped.body,
    nextStep: mapped.nextStep,
  };
}

export type ChatSensitivity =
  | { kind: "temporary"; label: string }
  | { kind: "legal_hold"; label: string }
  | { kind: "retained"; label: string };

/** Session-bar sensitivity: temporary, legal hold, or retained. */
export function chatSensitivity(input: {
  temporary?: boolean | undefined;
  legalHoldUntil?: string | undefined;
  expiresAt?: string | undefined;
}): ChatSensitivity {
  if (input.temporary === true) {
    return { kind: "temporary", label: "Temporary" };
  }
  if (
    input.legalHoldUntil !== undefined &&
    input.legalHoldUntil.trim().length > 0
  ) {
    return { kind: "legal_hold", label: "Legal hold" };
  }
  return { kind: "retained", label: "Retained" };
}

export type ChatWriteAction =
  | "regenerate"
  | "branch"
  | "delete"
  | "share"
  | "edit"
  | "rate"
  | "export"
  | "send"
  | "attach";

export type ChatAccessLevel = "owner" | "write" | "read";

/**
 * Resolve the caller's effective access for a chat, mirroring server
 * canAccessChat: admin/owner → owner; write grant → write; read grant → read.
 */
export function resolveChatAccess(input: {
  subjectId: string | undefined;
  isAdmin?: boolean | undefined;
  groupIds?: readonly string[] | undefined;
  /**
   * Owner of the loaded chat. When undefined there is no persisted chat yet
   * (new draft / empty composer) — the viewer is composing as owner.
   */
  chatCreatedBy: string | undefined;
  grants: ReadonlyArray<{
    principalType: string;
    principalId: string;
    permission: string;
  }>;
}): ChatAccessLevel {
  if (input.isAdmin === true) return "owner";
  // No active chat row yet: first-message compose must not be treated as a
  // shared read-only view of someone else's thread.
  if (input.chatCreatedBy === undefined) return "owner";
  if (
    input.subjectId !== undefined &&
    input.chatCreatedBy === input.subjectId
  ) {
    return "owner";
  }
  const groups = input.groupIds ?? [];
  const subjectId = input.subjectId;
  const mine = input.grants.filter((grant) => {
    if (grant.principalType === "user") {
      return subjectId !== undefined && grant.principalId === subjectId;
    }
    if (grant.principalType === "group") {
      return groups.includes(grant.principalId);
    }
    return false;
  });
  if (mine.some((grant) => grant.permission === "write")) return "write";
  if (mine.some((grant) => grant.permission === "read")) return "read";
  // Existing chat owned by someone else, no matching grant: read-only chrome.
  return "read";
}

/** Read-only shares may rate/export/copy; write actions need write/owner. */
export function canPerformChatWriteAction(
  access: ChatAccessLevel,
  action: ChatWriteAction,
): boolean {
  if (access === "owner" || access === "write") return true;
  return action === "rate" || action === "export";
}

export function formatBranchTitle(sourceTitle: string): string {
  const base = sourceTitle.trim() || "Untitled chat";
  const title = `Branch of ${base}`;
  return title.length <= 200 ? title : title.slice(0, 200);
}

export function parseBranchOrigin(title: string): {
  sourceTitle: string;
} | null {
  const match = /^Branch of (.+)$/u.exec(title.trim());
  if (match === null || match[1] === undefined) return null;
  const sourceTitle = match[1].trim();
  if (sourceTitle.length === 0) return null;
  return { sourceTitle };
}

const BRANCH_ORIGIN_KEY = "romeo:branch-origins:v1";

export function rememberBranchOrigin(input: {
  forkChatId: string;
  sourceChatId: string;
  sourceTitle: string;
}): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(BRANCH_ORIGIN_KEY);
    const map =
      raw === null
        ? {}
        : (JSON.parse(raw) as Record<
            string,
            { sourceChatId: string; sourceTitle: string }
          >);
    map[input.forkChatId] = {
      sourceChatId: input.sourceChatId,
      sourceTitle: input.sourceTitle,
    };
    localStorage.setItem(BRANCH_ORIGIN_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / private mode.
  }
}

export function readBranchOrigin(forkChatId: string): {
  sourceChatId: string;
  sourceTitle: string;
} | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(BRANCH_ORIGIN_KEY);
    if (raw === null) return null;
    const map = JSON.parse(raw) as Record<
      string,
      { sourceChatId: string; sourceTitle: string }
    >;
    const hit = map[forkChatId];
    if (
      hit === undefined ||
      typeof hit.sourceChatId !== "string" ||
      typeof hit.sourceTitle !== "string"
    ) {
      return null;
    }
    return hit;
  } catch {
    return null;
  }
}

/** Structured negative-feedback reasons (persisted as reasonCode). */
export const FEEDBACK_REASON_CODES = [
  "inaccurate",
  "unhelpful",
  "unsafe",
  "off_topic",
  "too_long",
  "other",
] as const;

export type FeedbackReasonCode = (typeof FEEDBACK_REASON_CODES)[number];

export function isFeedbackReasonCode(
  value: string,
): value is FeedbackReasonCode {
  return (FEEDBACK_REASON_CODES as readonly string[]).includes(value);
}

export function normalizeFeedbackReasonCode(
  rating: "negative" | "none" | "positive",
  reasonCode: string | undefined,
): string | undefined {
  if (rating !== "negative") return undefined;
  if (reasonCode === undefined) return undefined;
  const trimmed = reasonCode.trim();
  if (!isFeedbackReasonCode(trimmed)) return undefined;
  return trimmed;
}

/** Compliance export must include these fields when present on the payload. */
export function complianceExportChecklist(exportPayload: {
  schema?: string;
  exportedAt?: string;
  chat?: { id?: string; title?: string; modelId?: string; agentId?: string };
  messages?: Array<{
    id?: string;
    role?: string;
    content?: string;
    modelId?: string;
    createdAt?: string;
    citations?: unknown[];
  }>;
}): {
  hasSchema: boolean;
  hasExportedAt: boolean;
  hasChatIdentity: boolean;
  hasMessages: boolean;
  messagesHaveTimestamps: boolean;
  messagesMayIncludeModel: boolean;
  messagesMayIncludeCitations: boolean;
  complete: boolean;
} {
  const hasSchema = exportPayload.schema === "romeo.chat-export.v1";
  const hasExportedAt =
    typeof exportPayload.exportedAt === "string" &&
    exportPayload.exportedAt.length > 0;
  const hasChatIdentity =
    typeof exportPayload.chat?.id === "string" &&
    typeof exportPayload.chat?.title === "string";
  const messages = exportPayload.messages ?? [];
  const hasMessages = messages.length > 0;
  const messagesHaveTimestamps =
    hasMessages &&
    messages.every(
      (m) => typeof m.createdAt === "string" && m.createdAt.length > 0,
    );
  const messagesMayIncludeModel = messages.some(
    (m) => typeof m.modelId === "string" && m.modelId.length > 0,
  );
  const messagesMayIncludeCitations = messages.some(
    (m) => Array.isArray(m.citations) && m.citations.length > 0,
  );
  const complete =
    hasSchema &&
    hasExportedAt &&
    hasChatIdentity &&
    hasMessages &&
    messagesHaveTimestamps;
  return {
    hasSchema,
    hasExportedAt,
    hasChatIdentity,
    hasMessages,
    messagesHaveTimestamps,
    messagesMayIncludeModel,
    messagesMayIncludeCitations,
    complete,
  };
}

export type StreamRecoveryPhase =
  | "connected"
  | "reconnecting"
  | "failed"
  | "idle";

/** Map reconnect attempt counter to a user-visible recovery phase. */
export function streamRecoveryPhase(input: {
  isStreaming: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  hasTerminalError: boolean;
}): StreamRecoveryPhase {
  if (input.hasTerminalError) return "failed";
  if (!input.isStreaming) return "idle";
  if (input.reconnectAttempts <= 0) return "connected";
  if (input.reconnectAttempts > input.maxReconnectAttempts) return "failed";
  return "reconnecting";
}

export function streamRecoveryLabel(phase: StreamRecoveryPhase): string {
  switch (phase) {
    case "reconnecting":
      return "Reconnecting to the model stream…";
    case "failed":
      return "Lost connection to the stream. Retry the message.";
    case "connected":
      return "Streaming";
    case "idle":
      return "";
  }
}
