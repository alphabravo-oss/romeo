import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";
import { consumeQuota } from "./consume-quota";
import { fileIdsForMessagePart } from "./message-part-v1";
import { advanceChatLeaf } from "./run-command-service";
import type { RunEventSequencer } from "./run-event-sequencer";
import { isTerminalRunStatus } from "./run-recovery-service";
import { persistRunRetrievalEvent } from "./run-retrieval-event-persistence";
import type {
  DeferredRunStart,
  PreparedRunStart,
  RunServiceOptions,
} from "./run-service-contracts";
import { recordRunStartedUsage } from "./run-usage";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import type { WebhookEmitter } from "./webhook-service";

export async function persistPreparedRunStart(input: {
  beginExecution: (prepared: PreparedRunStart, run: RunRecord) => void;
  options: RunServiceOptions;
  prepared: PreparedRunStart;
  repository: RomeoRepository;
  runEventSequencer: RunEventSequencer;
  webhooks: WebhookEmitter | undefined;
}): Promise<DeferredRunStart> {
  const { prepared, repository } = input;
  const active = (await repository.listRuns(prepared.run.chatId)).find(
    (run) => !isTerminalRunStatus(run.status),
  );
  if (active !== undefined) {
    throw new ApiError(
      "chat_run_in_progress",
      "This chat is already generating a response.",
      409,
    );
  }
  await consumeQuota(
    repository,
    prepared.input.subject,
    {
      agentId: prepared.agentId,
      metric: "run.started",
      providerId: prepared.quotaTarget.provider.id,
      quantity: 1,
      workspaceId: prepared.run.workspaceId,
    },
    {
      quotaCoordinator: input.options.quotaCoordinator,
      webhooks: input.webhooks,
    },
  );
  await repository.createMessage(prepared.userMessage);
  await advanceChatLeaf(
    repository,
    prepared.run.chatId,
    prepared.userMessage.id,
  );
  if (prepared.messageParts.length > 0)
    await repository.createMessageParts(prepared.messageParts);
  const fileReferenceCount = prepared.messageParts.reduce(
    (count, part) => count + fileIdsForMessagePart(part).length,
    0,
  );
  if (fileReferenceCount > 0)
    await writeAuditLog(repository, {
      subject: prepared.input.subject,
      action: "file.reference.attach",
      resourceType: "chat",
      resourceId: prepared.run.chatId,
      metadata: {
        messageId: prepared.userMessage.id,
        referenceCount: fileReferenceCount,
        workspaceId: prepared.run.workspaceId,
      },
    });
  const createdBy = await persistedSubjectActorId(
    repository,
    prepared.input.subject,
    { kind: "service_account_run", name: "Service Account Run Actor" },
  );
  const run = await repository.createRun({ ...prepared.run, createdBy });
  const retrievalEvents = await persistRunRetrievalEvent(
    repository,
    input.runEventSequencer,
    {
      runId: run.id,
      citations: prepared.citations,
      safety: prepared.knowledgeSafety,
    },
  );
  await recordRunStartedUsage(repository, {
    run: {
      ...run,
      modelId: prepared.quotaTarget.model.id,
      providerId: prepared.quotaTarget.provider.id,
    },
    inputTokens: prepared.estimatedInputTokens,
    model: prepared.quotaTarget.model,
    historyMessages: prepared.historyMessages,
    historyTruncated: prepared.historyTruncated,
    imageInputCount: prepared.messages.reduce(
      (count, message) =>
        count + ("images" in message ? (message.images?.length ?? 0) : 0),
      0,
    ),
    knowledgeHitsDropped: prepared.knowledgeHitsDropped,
    routing: prepared.routingDecision,
  });
  return {
    inputMessageId: prepared.userMessage.id,
    run,
    startExecution: () => {
      void input.runEventSequencer.notify(retrievalEvents);
      input.beginExecution(prepared, run);
    },
  };
}
