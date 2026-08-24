import type { AuthSubject } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";
import type { BaseModel, ProviderTokenUsage } from "@romeo/providers";

import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { advanceChatLeaf, runUserMessage } from "./run-command-service";
import { enforceContentPolicyText } from "./content-policy-service";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { RunKnowledgeCitation } from "./run-knowledge";
import type { PersistedOutputPartRef } from "./persist-output-parts";
import { parseMessagePartV1 } from "./message-part-v1";
import { createId } from "../ids";
import { recordRunTerminalUsage } from "./run-usage";
import {
  continueTelemetryContextFromPayload,
  currentTelemetryMetadata,
} from "./telemetry-context";
import type { WebhookEmitter } from "./webhook-service";

export const runTerminalOutboxJobType = "run.terminal_webhook";

export interface RunTerminalOutboxPayload {
  schemaVersion: "romeo.run-terminal-outbox.v1";
  runId: string;
  eventType: "run.cancelled" | "run.completed" | "run.failed";
  webhookPayload: Record<string, unknown>;
}

export interface PersistTerminalRunInput {
  run: RunRecord;
  /** Original authenticated actor, used to govern provider-generated output. */
  subject?: AuthSubject;
  status: "cancelled" | "completed" | "failed";
  assistantContent: string;
  model?: BaseModel;
  providerUsage?: ProviderTokenUsage;
  citations?: RunKnowledgeCitation[];
  outputParts?: PersistedOutputPartRef[];
  /** Inline error shown as the assistant turn when the model run fails. */
  error?: {
    code: string;
    message?: string;
  };
  terminalEvent?: {
    type: "run.cancelled" | "run.completed" | "run.failed";
    data: Record<string, unknown>;
  };
}

export interface PersistTerminalRunResult {
  run: RunRecord | undefined;
  events: RunEvent[];
}

export async function persistTerminalRun(
  repository: RomeoRepository,
  runEventSequencer: RunEventSequencer,
  input: PersistTerminalRunInput,
): Promise<RunRecord | undefined> {
  const completedAt = new Date().toISOString();
  const assistantContent =
    input.subject === undefined || input.assistantContent.length === 0
      ? input.assistantContent
      : (
          await enforceContentPolicyText(
            repository,
            input.subject,
            input.assistantContent,
          )
        ).content;
  const result = await repository.transaction((transaction) =>
    persistTerminalRunInRepository(
      transaction,
      runEventSequencer,
      { ...input, assistantContent },
      completedAt,
    ),
  );
  await runEventSequencer.notify(result.events);
  return result.run;
}

export async function persistTerminalRunInRepository(
  repository: RomeoRepository,
  runEventSequencer: RunEventSequencer,
  input: PersistTerminalRunInput,
  completedAt: string,
): Promise<PersistTerminalRunResult> {
  const finalized = await repository.finalizeRun({
    runId: input.run.id,
    status: input.status,
    completedAt,
  });
  if (finalized === undefined) return { run: undefined, events: [] };
  const events: RunEvent[] = [];
  if (input.terminalEvent !== undefined) {
    const event = await runEventSequencer.create(repository, {
      runId: finalized.id,
      type: input.terminalEvent.type,
      data: input.terminalEvent.data,
    });
    await runEventSequencer.persist(repository, [event]);
    events.push(event);
  }
  await recordRunTerminalUsage(repository, {
    run: finalized,
    status: input.status,
    assistantContent: input.assistantContent,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.providerUsage === undefined
      ? {}
      : { providerUsage: input.providerUsage }),
    runEvents: await repository.listRunEvents(finalized.id),
  });
  await writeAuditLog(repository, {
    id: `audit_run_terminal_${finalized.id}`,
    orgId: finalized.orgId,
    actorId: finalized.createdBy,
    action: `run.${input.status}`,
    resourceType: "run",
    resourceId: finalized.id,
    outcome: input.status === "failed" ? "failure" : "success",
    metadata: {
      status: input.status,
      chatId: finalized.chatId,
      workspaceId: finalized.workspaceId,
      agentId: finalized.agentId,
      agentVersionId: finalized.agentVersionId,
      modelId: finalized.modelId,
      providerId: finalized.providerId,
    },
    createdAt: completedAt,
  });
  const error = terminalRunError(input);
  // Failures and cancels always mint an assistant row so the transcript keeps
  // an inline error in place of the missing answer, even when no tokens arrived.
  if (
    input.assistantContent.length > 0 ||
    error !== undefined ||
    (input.outputParts?.length ?? 0) > 0
  ) {
    // The parent is the run's own user message, never the chat's leaf pointer: switching variants
    // while this run streams would otherwise graft the answer onto the branch the reader is looking
    // at rather than the one that asked the question.
    const parent = runUserMessage(
      finalized,
      await repository.listMessages(finalized.chatId),
    );
    const assistantId = `msg_run_terminal_${finalized.id}`;
    await repository.createMessage({
      id: assistantId,
      chatId: finalized.chatId,
      role: "assistant",
      content: input.assistantContent,
      ...(input.citations === undefined || input.citations.length === 0
        ? {}
        : { citations: input.citations }),
      ...(error === undefined ? {} : { error }),
      modelId: finalized.modelId,
      ...(parent === undefined ? {} : { parentId: parent.id }),
      createdAt: completedAt,
    });
    if (input.outputParts !== undefined && input.outputParts.length > 0) {
      await repository.createMessageParts(
        input.outputParts.map((part, index) =>
          outputMessagePart(part, {
            createdAt: completedAt,
            messageId: assistantId,
            modelId: finalized.modelId,
            position: index,
          }),
        ),
      );
      await repository.reconcileChatFileReferences(
        finalized.chatId,
        completedAt,
      );
    }
    await advanceChatLeaf(repository, finalized.chatId, assistantId);
  }
  const eventType = terminalWebhookEventType(input.status);
  await repository.createBackgroundJob({
    id: `job_run_terminal_${finalized.id}`,
    orgId: finalized.orgId,
    workspaceId: finalized.workspaceId,
    type: runTerminalOutboxJobType,
    status: "queued",
    payload: {
      schemaVersion: "romeo.run-terminal-outbox.v1",
      runId: finalized.id,
      eventType,
      webhookPayload: {
        runId: finalized.id,
        chatId: finalized.chatId,
        workspaceId: finalized.workspaceId,
        agentId: finalized.agentId,
        agentVersionId: finalized.agentVersionId,
        modelId: finalized.modelId,
        providerId: finalized.providerId,
        status: input.status,
        completedAt,
      },
      ...currentTelemetryMetadata(),
    } satisfies RunTerminalOutboxPayload,
    createdAt: completedAt,
    updatedAt: completedAt,
  });
  return { run: finalized, events };
}

function outputMessagePart(
  part: PersistedOutputPartRef,
  input: {
    createdAt: string;
    messageId: string;
    modelId: string;
    position: number;
  },
) {
  const common = {
    createdAt: input.createdAt,
    id: createId("msg_part"),
    messageId: input.messageId,
    position: input.position,
    provenance: { modelId: input.modelId, source: "provider" as const },
    schemaVersion: 1 as const,
  };
  if (
    part.type === "image_ref" &&
    part.fileId !== undefined &&
    part.mediaType !== undefined
  )
    return parseMessagePartV1({
      ...common,
      altText: "Provider-generated image",
      fileId: part.fileId,
      mediaType: part.mediaType,
      type: "image_ref",
    });
  if (
    part.type === "audio_ref" &&
    part.fileId !== undefined &&
    part.mediaType !== undefined &&
    part.durationMs !== undefined
  )
    return parseMessagePartV1({
      ...common,
      durationMs: part.durationMs,
      fileId: part.fileId,
      mediaType: part.mediaType,
      type: "audio_ref",
    });
  if (
    part.type === "citation_ref" &&
    part.sourceId !== undefined &&
    part.documentId !== undefined &&
    part.title !== undefined
  )
    return parseMessagePartV1({
      ...common,
      sourceId: part.sourceId,
      documentId: part.documentId,
      ...(part.chunkId === undefined ? {} : { chunkId: part.chunkId }),
      title: part.title,
      type: "citation_ref",
    });
  throw new Error("provider_output_part_not_persistable");
}

export async function drainRunTerminalOutbox(input: {
  repository: RomeoRepository;
  webhooks?: WebhookEmitter;
  workerId: string;
  orgId: string;
  signal?: AbortSignal;
}): Promise<number> {
  let processed = 0;
  while (true) {
    if (input.signal?.aborted === true) return processed;
    const job = await input.repository.claimBackgroundJob({
      orgId: input.orgId,
      type: runTerminalOutboxJobType,
      workerId: input.workerId,
      leaseSeconds: 60,
    });
    if (job === undefined) return processed;
    continueTelemetryContextFromPayload(job.payload);
    const payload = runTerminalOutboxPayload(job.payload);
    if (payload === undefined) {
      const failedAt = new Date().toISOString();
      await input.repository.updateBackgroundJobWithLease({
        workerId: input.workerId,
        job: {
          ...job,
          status: "failed",
          payload: {
            ...job.payload,
            errorCode: "invalid_terminal_outbox_payload",
          },
          updatedAt: failedAt,
          completedAt: failedAt,
        },
      });
      processed += 1;
      continue;
    }
    try {
      await input.webhooks?.emit({
        orgId: job.orgId,
        eventType: payload.eventType,
        payload: payload.webhookPayload,
        idempotencyKey: job.id,
      });
      const completedAt = new Date().toISOString();
      const completed = await input.repository.updateBackgroundJobWithLease({
        workerId: input.workerId,
        job: {
          ...job,
          status: "completed",
          payload: { ...job.payload, deliveredAt: completedAt },
          updatedAt: completedAt,
          completedAt,
        },
      });
      if (completed === undefined) return processed;
      processed += 1;
    } catch {
      return processed;
    }
  }
}

function terminalWebhookEventType(
  status: "cancelled" | "completed" | "failed",
): RunTerminalOutboxPayload["eventType"] {
  if (status === "cancelled") return "run.cancelled";
  return status === "completed" ? "run.completed" : "run.failed";
}

function terminalRunError(
  input: PersistTerminalRunInput,
): PersistTerminalRunInput["error"] | undefined {
  if (input.error !== undefined) return normalizeRunError(input.error);
  if (input.status === "cancelled")
    return {
      code: "run_cancelled",
      message: "The response was stopped.",
    };
  if (input.status !== "failed") return undefined;
  const data = input.terminalEvent?.data ?? {};
  const code =
    typeof data.errorCode === "string" && data.errorCode.trim().length > 0
      ? data.errorCode.trim()
      : "provider_run_failed";
  const message =
    typeof data.message === "string" && data.message.trim().length > 0
      ? data.message.trim()
      : undefined;
  return normalizeRunError({
    code,
    ...(message === undefined ? {} : { message }),
  });
}

function normalizeRunError(error: {
  code: string;
  message?: string;
}): NonNullable<PersistTerminalRunInput["error"]> {
  return {
    code: error.code.trim().slice(0, 120) || "provider_run_failed",
    ...(error.message !== undefined && error.message.trim().length > 0
      ? { message: error.message.trim().slice(0, 2_000) }
      : {}),
  };
}

function runTerminalOutboxPayload(
  value: Record<string, unknown>,
): RunTerminalOutboxPayload | undefined {
  if (
    value.schemaVersion !== "romeo.run-terminal-outbox.v1" ||
    typeof value.runId !== "string" ||
    (value.eventType !== "run.cancelled" &&
      value.eventType !== "run.completed" &&
      value.eventType !== "run.failed") ||
    value.webhookPayload === null ||
    typeof value.webhookPayload !== "object" ||
    Array.isArray(value.webhookPayload)
  )
    return undefined;
  return {
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    eventType: value.eventType,
    webhookPayload: value.webhookPayload as Record<string, unknown>,
  };
}
import { writeAuditLog } from "./audit-log";
