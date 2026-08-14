import { hasGrant, hasScope, type AuthSubject } from "@romeo/auth";
import type { RunEvent, RunEventType } from "@romeo/ai-runtime";

import type {
  AgentVersion,
  Message,
  RunRecord,
  UsageEvent,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { getAuthorizedChat } from "./chat-access";
import { canReadKnowledgeSource } from "./knowledge-source-access";
import { runUserMessage } from "./run-command-service";
import { RunAccessService } from "./run-access-service";
import { citationsFromRunEvents } from "./run-stream-service";

const visibleMessageLimit = 8;
const visibleContentLimit = 20_000;
const checkpointLimit = 50;
const citationLimit = 100;
const toolLimit = 50;
const usageLimit = 20;
type SafeCheckpointType = Exclude<
  RunEventType,
  "message.delta" | "message.reasoning" | "reasoning.summary.delta"
>;

const safeCheckpointTypes = new Set<SafeCheckpointType>([
  "run.started",
  "message.started",
  "message.completed",
  "reasoning.summary.completed",
  "retrieval.completed",
  "tool.requested",
  "tool.started",
  "tool.approval_required",
  "tool.completed",
  "tool.failed",
  "run.cancelled",
  "run.completed",
  "run.failed",
  "run.continuing",
  "run.waiting_tool_approval",
  "run.waiting_tool_dispatch",
  "output.part.ready",
]);

export class PersistedRunContextInspectionService {
  private readonly access: RunAccessService;

  constructor(private readonly repository: RomeoRepository) {
    this.access = new RunAccessService(repository);
  }

  async inspect(input: {
    chatId: string;
    runId?: string;
    subject: AuthSubject;
  }) {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      permission: "read",
      scope: "chats:read",
      subject: input.subject,
    });
    const candidate =
      input.runId === undefined
        ? (await this.repository.listRuns(chat.id))[0]
        : await this.repository.getRun(input.runId);
    if (candidate === undefined) {
      if (input.runId !== undefined) throw notFound("Run");
      return null;
    }
    const run = await this.access.getAuthorizedRun(
      candidate.id,
      input.subject,
      "runs:read",
    );
    if (run.chatId !== chat.id) throw notFound("Run");

    const events = await this.repository.listRunEvents(run.id);
    const outputMessage = await this.outputMessage(run);
    const inputMessage = await this.inputMessage(run, outputMessage);
    const citations = uniqueCitations([
      ...(outputMessage?.citations ?? []),
      ...citationsFromRunEvents(events),
    ]);
    const selected = selectedTarget(run, events);
    const [messages, visibleCitations, model, provider, tools, version, usage] =
      await Promise.all([
        this.visibleBranchMessages(run, inputMessage, chat.transcriptVersion),
        this.visibleCitations(run, input.subject, citations),
        this.repository.getModel(selected.modelId),
        this.repository.getProvider(selected.providerId),
        this.repository.listToolCallsForRun(
          run.orgId,
          run.workspaceId,
          run.id,
          toolLimit,
        ),
        this.repository.getAgentVersion(run.agentVersionId),
        this.repository.listUsageEventsForRun(
          run.orgId,
          run.workspaceId,
          run.id,
          usageLimit,
        ),
      ]);
    const availableProvider =
      provider !== undefined && provider.orgId === run.orgId
        ? provider
        : undefined;
    const availableModel =
      model !== undefined &&
      availableProvider !== undefined &&
      model.providerId === availableProvider.id
        ? model
        : undefined;
    return {
      run: {
        id: run.id,
        chatId: run.chatId,
        agentId: run.agentId,
        agentVersionId: run.agentVersionId,
        status: run.status,
        createdAt: run.createdAt,
        ...(run.completedAt === undefined
          ? {}
          : { completedAt: run.completedAt }),
      },
      branch: {
        ...(inputMessage === undefined
          ? {}
          : { inputMessageId: inputMessage.id }),
        ...(inputMessage?.parentId === undefined
          ? {}
          : { parentMessageId: inputMessage.parentId }),
        visibleMessageCount: messages.length,
        currentTranscriptVersion: chat.transcriptVersion ?? "0",
      },
      model: {
        id: selected.modelId,
        ...(availableModel === undefined
          ? {}
          : { displayName: boundedLabel(availableModel.displayName, 300) }),
        available: availableModel !== undefined,
      },
      provider: {
        id: selected.providerId,
        ...(availableProvider === undefined
          ? {}
          : { displayName: boundedLabel(availableProvider.name, 300) }),
        available: availableProvider !== undefined,
      },
      messages,
      checkpoints: events
        .filter(isSafeCheckpoint)
        .slice(-checkpointLimit)
        .map((event) => ({
          sequence: event.sequence,
          type: event.type,
          createdAt: event.createdAt,
        })),
      knowledge: {
        totalCitationCount: citations.length,
        revokedOrUnavailableCount: citations.length - visibleCitations.length,
        citations: visibleCitations,
      },
      tools: tools.map((tool) => ({
        toolId: tool.toolId,
        status: tool.status,
        riskLevel: boundedLabel(tool.riskLevel, 100),
        approvalRequired: tool.approvalRequired,
        startedAt: tool.startedAt,
        completedAt: tool.completedAt,
      })),
      policies: safePolicies(run, version),
      transformations: safeTransformations(events, run, usage),
    };
  }

  private async inputMessage(
    run: RunRecord,
    output: Message | undefined,
  ): Promise<Message | undefined> {
    if (output?.parentId !== undefined) {
      const parent = await this.repository.getMessage(output.parentId);
      if (parent?.chatId === run.chatId && parent.role === "user")
        return parent;
    }
    return runUserMessage(run, await this.repository.listMessages(run.chatId));
  }

  private async outputMessage(run: RunRecord): Promise<Message | undefined> {
    const message = await this.repository.getMessage(
      `msg_run_terminal_${run.id}`,
    );
    return message?.chatId === run.chatId && message.role === "assistant"
      ? message
      : undefined;
  }

  private async visibleBranchMessages(
    run: RunRecord,
    inputMessage: Message | undefined,
    transcriptVersion: string | undefined,
  ) {
    if (inputMessage === undefined) return [];
    const page = await this.repository.queryAuthorizedMessagesPage({
      chatId: run.chatId,
      limit: visibleMessageLimit,
      mode: "branch",
      orgId: run.orgId,
      transcriptVersion: transcriptVersion ?? "0",
      workspaceId: run.workspaceId,
      branchLeafMessageId: inputMessage.id,
    });
    if (page.invalidBranch === true || page.invalidTranscriptVersion === true)
      return [];
    return page.items.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const content = boundedContent(message.content);
      return [
        {
          id: message.id,
          role: message.role,
          content: content.value,
          contentTruncated: content.truncated,
          createdAt: message.createdAt,
        },
      ];
    });
  }

  private async visibleCitations(
    run: RunRecord,
    subject: AuthSubject,
    citations: Citation[],
  ) {
    const internalSourceLabels = new Map<string, string>();
    if (hasScope(subject, "knowledge:read")) {
      const [bases, grants] = await Promise.all([
        this.repository.listKnowledgeBases(run.workspaceId),
        this.repository.listResourceGrants(run.orgId),
      ]);
      const readable = bases.filter(
        (base) =>
          base.orgId === run.orgId &&
          hasGrant(subject, grants, "knowledge_base", base.id, "read"),
      );
      const sources = (
        await Promise.all(
          readable.map((base) => this.repository.listKnowledgeSources(base.id)),
        )
      ).flat();
      for (const source of sources) {
        if (
          source.orgId === run.orgId &&
          source.workspaceId === run.workspaceId &&
          canReadKnowledgeSource(source, subject)
        )
          internalSourceLabels.set(
            source.id,
            boundedLabel(source.fileName, 1_000),
          );
      }
    }
    return citations.slice(0, citationLimit).flatMap((citation) => {
      const publicWebSource =
        citation.sourceType === "url" || citation.sourceType === "web_search";
      const internalLabel = internalSourceLabels.get(citation.documentId);
      if (!publicWebSource && internalLabel === undefined) return [];
      const sourceType = safeOptionalLabel(citation.sourceType, 100);
      const provider = safeOptionalLabel(citation.provider, 100);
      return [
        {
          chunkId: citation.chunkId,
          documentId: citation.documentId,
          title: internalLabel ?? boundedLabel(citation.title, 1_000),
          ...(sourceType === undefined ? {} : { sourceType }),
          ...(provider === undefined ? {} : { provider }),
        },
      ];
    });
  }
}

interface Citation {
  chunkId: string;
  documentId: string;
  title: string;
  sourceType?: string;
  provider?: string;
}

function uniqueCitations(citations: Citation[]): Citation[] {
  return [
    ...new Map(
      citations.map((citation) => [
        `${citation.documentId}\0${citation.chunkId}`,
        citation,
      ]),
    ).values(),
  ];
}

function isSafeCheckpoint(
  event: RunEvent,
): event is RunEvent & { type: SafeCheckpointType } {
  return safeCheckpointTypes.has(event.type as SafeCheckpointType);
}

function selectedTarget(run: RunRecord, events: RunEvent[]) {
  for (const event of [...events].reverse()) {
    const fallback = recordValue(event.data, "providerFallback");
    const modelId = stringValue(fallback, "toModelId");
    const providerId = stringValue(fallback, "toProviderId");
    if (modelId !== undefined && providerId !== undefined)
      return { modelId, providerId };
  }
  return { modelId: run.modelId, providerId: run.providerId };
}

function safePolicies(run: RunRecord, version: AgentVersion | undefined) {
  const valid =
    version?.agentId === run.agentId &&
    version.orgId === run.orgId &&
    version.workspaceId === run.workspaceId
      ? version
      : undefined;
  const memory = valid?.memoryPolicy ?? { mode: "disabled" as const };
  const safety = valid?.safetySettings;
  return {
    memoryMode: memory.mode,
    ...(memory.maxMessages === undefined
      ? {}
      : { memoryMessageLimit: memory.maxMessages }),
    ...(safety?.knowledgeGroundingMode === undefined
      ? {}
      : { knowledgeGroundingMode: safety.knowledgeGroundingMode }),
    ...(safety?.maxUserInputLength === undefined
      ? {}
      : { maxUserInputLength: safety.maxUserInputLength }),
    blockedTermCount: safety?.blockedTerms?.length ?? 0,
    ...(safety?.promptInjectionGuard === undefined
      ? {}
      : { promptInjectionGuard: safety.promptInjectionGuard }),
  };
}

function safeTransformations(
  events: RunEvent[],
  run: RunRecord,
  usage: UsageEvent[],
) {
  const transformations: Array<{
    type:
      | "content_policy_applied"
      | "history_trimmed"
      | "knowledge_dropped"
      | "knowledge_prompt_injection_filtered"
      | "provider_fallback";
    count?: number;
  }> = [{ type: "content_policy_applied" }];
  const inputUsage = usage.find(
    (event) =>
      event.sourceType === "run" &&
      event.sourceId === run.id &&
      event.metric === "llm.input_token.estimated",
  );
  if (inputUsage?.metadata.historyTruncated === true)
    transformations.push({ type: "history_trimmed" });
  const dropped = nonnegativeInteger(inputUsage?.metadata.knowledgeHitsDropped);
  if (dropped !== undefined && dropped > 0)
    transformations.push({ type: "knowledge_dropped", count: dropped });
  const filtered = events.reduce((count, event) => {
    if (event.type !== "retrieval.completed") return count;
    const safety = recordValue(event.data, "safety");
    return (
      count + (nonnegativeInteger(safety?.promptInjectionSkippedCount) ?? 0)
    );
  }, 0);
  if (filtered > 0)
    transformations.push({
      type: "knowledge_prompt_injection_filtered",
      count: filtered,
    });
  if (selectedTarget(run, events).modelId !== run.modelId)
    transformations.push({ type: "provider_fallback" });
  return transformations;
}

function recordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : undefined;
}

function stringValue(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}

function boundedContent(content: string): {
  truncated: boolean;
  value: string;
} {
  return content.length <= visibleContentLimit
    ? { truncated: false, value: content }
    : { truncated: true, value: content.slice(0, visibleContentLimit) };
}

function boundedLabel(value: string, limit: number): string {
  const trimmed = value.trim();
  return (trimmed.length === 0 ? "Unavailable" : trimmed).slice(0, limit);
}

function safeOptionalLabel(
  value: string | undefined,
  limit: number,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? undefined
    : trimmed.slice(0, limit);
}
