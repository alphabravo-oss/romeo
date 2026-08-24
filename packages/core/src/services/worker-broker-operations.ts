import type { AuthSubject } from "@romeo/auth";

import type { KnowledgeSource } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type { RomeoServices } from "./service-registry-types";
import {
  browserAutomationJobType,
  type BrowserAutomationCompletionResult,
} from "./browser-automation-task-types";
import { readBrowserAutomationWorkerLease } from "./browser-automation-tasks";
import { systemAuditActorId } from "./system-audit-actor";
import { readWorkerLease as readToolWorkerLease } from "./tool-operation-dispatch-request-payload";
import { dispatchRequestType } from "./tool-operation-dispatch-request-types";
import type {
  WorkerBrokerClaimInput,
  WorkerBrokerCompleteInput,
} from "./worker-broker";
import type { WorkerBrokerClaimTokenPayload } from "./worker-broker-token";

export interface ClaimedBrokerWork {
  claim: unknown;
  payload: WorkerBrokerClaimTokenPayload;
}

export async function claimKnowledge(
  repository: RomeoRepository,
  input: WorkerBrokerClaimInput & { leaseOwner: string; orgId: string },
  now: Date,
): Promise<ClaimedBrokerWork | undefined> {
  const candidates = await knowledgeCandidates(repository, input.orgId);
  for (const source of candidates) {
    const leaseToken = createId("knowledge_broker_lease");
    const claimed = await repository.claimKnowledgeSourceExtraction({
      knowledgeBaseId: source.knowledgeBaseId,
      leaseExpiresAt: new Date(
        now.getTime() + input.leaseSeconds * 1_000,
      ).toISOString(),
      leaseOwner: input.leaseOwner,
      leaseToken,
      now: now.toISOString(),
      sourceId: source.id,
    });
    const lease = claimed?.extractionLease;
    if (claimed === undefined || lease === undefined) continue;
    return {
      claim: {
        source: publicKnowledgeSource(claimed),
        lease: {
          attempt: lease.attempt,
          expiresAt: lease.expiresAt,
          fencingToken: lease.fencingToken,
        },
      },
      payload: {
        attempt: lease.attempt,
        audience: input.audience,
        expiresAt: lease.expiresAt,
        fence: lease.fencingToken,
        leaseToken,
        orgId: input.orgId,
        version: 1,
        workerId: input.workerId,
        workId: claimed.id,
      },
    };
  }
  return undefined;
}

export async function renewKnowledge(
  repository: RomeoRepository,
  token: WorkerBrokerClaimTokenPayload,
  leaseSeconds: number,
  now: Date,
): Promise<ClaimedBrokerWork | undefined> {
  if (token.leaseToken === undefined) return undefined;
  const renewed = await repository.renewKnowledgeSourceExtractionLease({
    fencingToken: token.fence,
    leaseExpiresAt: new Date(
      now.getTime() + leaseSeconds * 1_000,
    ).toISOString(),
    leaseOwner: brokerLeaseOwner(token),
    leaseToken: token.leaseToken,
    now: now.toISOString(),
    sourceId: token.workId,
  });
  const lease = renewed?.extractionLease;
  if (renewed === undefined || lease === undefined) return undefined;
  return {
    claim: {
      source: publicKnowledgeSource(renewed),
      lease: {
        attempt: lease.attempt,
        expiresAt: lease.expiresAt,
        fencingToken: lease.fencingToken,
      },
    },
    payload: {
      ...token,
      expiresAt: lease.expiresAt,
      fence: lease.fencingToken,
    },
  };
}

export async function renewBackground(
  repository: RomeoRepository,
  services: RomeoServices,
  token: WorkerBrokerClaimTokenPayload,
  leaseSeconds: number,
): Promise<ClaimedBrokerWork | undefined> {
  await assertCurrentLease(repository, token, new Date());
  const subject = await existingBrokerSubject(repository, token);
  const claim =
    token.audience === "tool_dispatch"
      ? await services.toolConnectors.renewDispatchRequestLease({
          subject,
          jobId: token.workId,
          leaseSeconds,
        })
      : await services.browserAutomation.renewLease({
          subject,
          jobId: token.workId,
          leaseSeconds,
        });
  if (!claim.claimed || claim.job === undefined || claim.lease === undefined)
    return undefined;
  if (claim.lease.attempt !== token.attempt) return undefined;
  return {
    claim,
    payload: { ...token, expiresAt: claim.lease.expiresAt },
  };
}

export async function assertCurrentLease(
  repository: RomeoRepository,
  token: WorkerBrokerClaimTokenPayload,
  now: Date,
): Promise<void> {
  if (token.audience === "knowledge_extraction") {
    const source = await findKnowledgeSource(
      repository,
      token.orgId,
      token.workId,
    );
    const lease = source?.extractionLease;
    if (
      lease === undefined ||
      token.leaseToken === undefined ||
      lease.owner !== brokerLeaseOwner(token) ||
      lease.token !== token.leaseToken ||
      lease.attempt !== token.attempt ||
      lease.fencingToken !== token.fence ||
      Date.parse(lease.expiresAt) <= now.getTime()
    ) {
      throw leaseLost();
    }
    return;
  }
  const job = await repository.getBackgroundJob(token.orgId, token.workId);
  const expectedType =
    token.audience === "tool_dispatch"
      ? dispatchRequestType
      : browserAutomationJobType;
  const lease =
    job === undefined
      ? undefined
      : token.audience === "tool_dispatch"
        ? readToolWorkerLease(job)
        : readBrowserAutomationWorkerLease(job);
  if (
    job?.type !== expectedType ||
    job.status !== "running" ||
    lease === undefined ||
    lease.workerId !== brokerLeaseOwner(token) ||
    lease.attempt !== token.attempt ||
    token.fence !== token.attempt ||
    Date.parse(lease.expiresAt) <= now.getTime()
  ) {
    throw leaseLost();
  }
}

export async function completeKnowledgeExtraction(
  repository: RomeoRepository,
  services: RomeoServices,
  subject: AuthSubject,
  token: WorkerBrokerClaimTokenPayload,
  input: WorkerBrokerCompleteInput,
  now: Date,
): Promise<unknown> {
  const source = await findKnowledgeSource(
    repository,
    token.orgId,
    token.workId,
  );
  if (source?.extractionLease === undefined || token.leaseToken === undefined) {
    throw leaseLost();
  }
  const lease = source.extractionLease;
  if (!input.success) {
    const failed = await repository.finishKnowledgeSourceExtraction({
      chunks: [],
      fencingToken: token.fence,
      leaseOwner: lease.owner,
      leaseToken: token.leaseToken,
      now: now.toISOString(),
      source: {
        ...source,
        metadata: {
          ...source.metadata,
          extractionErrorCode: normalizeErrorCode(input.errorCode),
        },
        status: "failed",
        updatedAt: now.toISOString(),
      },
    });
    if (failed === undefined) throw leaseLost();
    return { source: publicKnowledgeSource(failed), outcome: "failed" };
  }
  const released = await repository.finishKnowledgeSourceExtraction({
    chunks: [],
    fencingToken: token.fence,
    leaseOwner: lease.owner,
    leaseToken: token.leaseToken,
    now: now.toISOString(),
    source: { ...source, status: "pending", updatedAt: now.toISOString() },
  });
  if (released === undefined) throw leaseLost();
  return services.knowledge.extractUpload({
    subject,
    knowledgeBaseId: source.knowledgeBaseId,
    sourceId: source.id,
  });
}

export function browserCompletionResult(
  value: Record<string, unknown> | undefined,
): BrowserAutomationCompletionResult {
  return (value ?? {}) as BrowserAutomationCompletionResult;
}

async function knowledgeCandidates(
  repository: RomeoRepository,
  orgId: string,
): Promise<KnowledgeSource[]> {
  const candidates: KnowledgeSource[] = [];
  for (const workspace of await repository.listWorkspaces(orgId)) {
    for (const base of await repository.listKnowledgeBases(workspace.id)) {
      candidates.push(...(await repository.listKnowledgeSources(base.id)));
    }
  }
  return candidates
    .filter(
      (source) =>
        source.objectKey !== undefined &&
        (source.status === "pending" || source.status === "extracting"),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

async function findKnowledgeSource(
  repository: RomeoRepository,
  orgId: string,
  sourceId: string,
): Promise<KnowledgeSource | undefined> {
  for (const source of await knowledgeCandidates(repository, orgId)) {
    if (source.id === sourceId) return source;
  }
  return undefined;
}

async function existingBrokerSubject(
  repository: RomeoRepository,
  token: WorkerBrokerClaimTokenPayload,
): Promise<AuthSubject> {
  const actorId = brokerLeaseOwner(token);
  const actor = await repository.getCurrentUser(actorId);
  if (actor === undefined) throw leaseLost();
  const scopes: ScopeForAudience =
    token.audience === "knowledge_extraction"
      ? ["knowledge:read", "knowledge:write"]
      : token.audience === "tool_dispatch"
        ? ["tools:manage", "runs:read"]
        : ["tools:manage"];
  return {
    groupIds: [],
    id: actor.id,
    isAdmin: false,
    orgId: token.orgId,
    scopes,
    type: "service_account",
    workspaceIds: (await repository.listWorkspaces(token.orgId)).map(
      (workspace) => workspace.id,
    ),
  };
}

type ScopeForAudience = AuthSubject["scopes"];

function brokerLeaseOwner(token: WorkerBrokerClaimTokenPayload): string {
  return systemAuditActorId(`worker_broker_${token.audience}`, token.orgId);
}

function publicKnowledgeSource(source: KnowledgeSource) {
  return {
    createdAt: source.createdAt,
    fileName: source.fileName,
    id: source.id,
    knowledgeBaseId: source.knowledgeBaseId,
    metadata: source.metadata,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    status: source.status,
    updatedAt: source.updatedAt,
    workspaceId: source.workspaceId,
  };
}

function normalizeErrorCode(value: string | undefined): string {
  return value !== undefined && /^[a-z0-9_.:-]{1,120}$/u.test(value)
    ? value
    : "worker_execution_failed";
}

function leaseLost(): ApiError {
  return new ApiError(
    "worker_broker_lease_lost",
    "The worker no longer owns this claim.",
    409,
  );
}
