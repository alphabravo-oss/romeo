import { assertScope, type AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchPayloadStorage,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestExpiryReason,
  ToolOperationDispatchRequestExpiryResult,
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestReadbackResult,
  ToolOperationDispatchTransport,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  isToolDispatchPayloadStoreReference,
  type ToolDispatchPayload,
  type ToolDispatchPayloadStore,
} from "./tool-dispatch-payload-store";
import { writeAuditLog } from "./audit-log";

export interface CompleteToolOperationDispatchRequestInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  jobId: string;
  repository: RomeoRepository;
  response: ToolOperationDispatchReadbackResponse;
  subject: AuthSubject;
}

export interface FailToolOperationDispatchRequestInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  errorCode: string;
  jobId: string;
  repository: RomeoRepository;
  subject: AuthSubject;
}

export interface CancelToolOperationDispatchRequestInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  jobId: string;
  reasonCode?: string;
  repository: RomeoRepository;
  subject: AuthSubject;
}

export interface ClaimToolOperationDispatchRequestInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  leaseSeconds: number;
  payloadStorage?: ToolOperationDispatchPayloadStorage;
  repository: RomeoRepository;
  subject: AuthSubject;
}

export interface ReadToolOperationDispatchRequestPayloadInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  jobId: string;
  repository: RomeoRepository;
  subject: AuthSubject;
}

export interface RenewToolOperationDispatchRequestLeaseInput {
  jobId: string;
  leaseSeconds: number;
  repository: RomeoRepository;
  subject: AuthSubject;
}

export interface ExpireToolOperationDispatchRequestsInput {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  limit: number;
  queuedTimeoutSeconds: number;
  repository: RomeoRepository;
  runningTimeoutSeconds: number;
  subject: AuthSubject;
}

const dispatchRequestType = "tool.operation.dispatch_request";
const dispatchRequestMaxAttempts = 3;
const workerQueue = "external_tool_operations" as const;

export async function claimToolOperationDispatchRequest(
  input: ClaimToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestClaimResult> {
  assertScope(input.subject, "tools:manage");
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "worker.enqueue",
    workerClass: workerQueue,
  });
  const result = await input.repository.transaction(async (repository) => {
    const job = await repository.claimBackgroundJob({
      orgId: input.subject.orgId,
      type: dispatchRequestType,
      workerId: input.subject.id,
      leaseSeconds: input.leaseSeconds,
      ...(input.payloadStorage === undefined
        ? {}
        : { payloadEquals: { payloadStorage: input.payloadStorage } }),
    });
    if (job === undefined) return { result: { claimed: false, workerQueue } };
    validateDispatchRequestPayload(job);
    const lease = readWorkerLease(job);
    if (lease === undefined) {
      throw new ApiError(
        "tool_operation_dispatch_request_lease_invalid",
        "Tool operation dispatch request lease is invalid or expired.",
        409,
      );
    }
    if (lease.attempt > dispatchRequestMaxAttempts) {
      const deadLettered = await deadLetterDispatchRequest(
        repository,
        input.subject,
        job,
        lease,
      );
      return {
        payloadStoreReference: jobPayloadStoreReference(deadLettered),
        result: { claimed: false, workerQueue },
      };
    }
    return { result: await claimResult(repository, job) };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function readToolOperationDispatchRequestPayload(
  input: ReadToolOperationDispatchRequestPayloadInput,
): Promise<ToolOperationDispatchRequestPayloadResult> {
  assertScope(input.subject, "tools:manage");
  const job = await findClaimedDispatchRequest(
    input.repository,
    input.subject,
    input.jobId,
  );
  const reference = jobPayloadStoreReference(job);
  if (reference === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_payload_not_managed",
      "Tool operation dispatch request does not use managed payload storage.",
      409,
      { payloadStorage: jobPayloadStorage(job) },
    );
  }
  if (input.dispatchPayloadStore === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_payload_store_not_configured",
      "Tool operation dispatch payload storage is not configured.",
      409,
    );
  }
  const stored = await readDispatchPayloadObject(
    input.dispatchPayloadStore,
    reference,
  );
  assertPayloadMatchesClaim(job, stored);
  await auditDispatchRequestReadback(
    input.repository,
    input.subject,
    job,
    "tool.operation.dispatch_request.payload.read",
    "success",
    { payloadStoreDriver: reference.driver },
  );
  return payloadResult(job, stored.payload);
}

export async function renewToolOperationDispatchRequestLease(
  input: RenewToolOperationDispatchRequestLeaseInput,
): Promise<ToolOperationDispatchRequestClaimResult> {
  assertScope(input.subject, "tools:manage");
  const job = await input.repository.renewBackgroundJobLease({
    orgId: input.subject.orgId,
    jobId: input.jobId,
    workerId: input.subject.id,
    leaseSeconds: input.leaseSeconds,
  });
  if (job === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_request_lease_invalid",
      "Tool operation dispatch request lease is invalid or expired.",
      409,
    );
  }
  validateDispatchRequestPayload(job);
  return claimResult(input.repository, job);
}

export async function completeToolOperationDispatchRequest(
  input: CompleteToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestReadbackResult> {
  assertScope(input.subject, "tools:manage");
  const result = await input.repository.transaction(async (repository) => {
    const job = await findClaimedDispatchRequest(
      repository,
      input.subject,
      input.jobId,
    );
    const now = new Date().toISOString();
    const completed = await repository.updateBackgroundJob({
      ...job,
      status: "completed",
      payload: {
        ...job.payload,
        workerCompletedAt: now,
        workerId: input.subject.id,
        workerResult: input.response,
      },
      updatedAt: now,
      completedAt: now,
    });
    await auditDispatchRequestReadback(
      repository,
      input.subject,
      completed,
      "tool.operation.dispatch_request.complete",
      "success",
      {
        responseStatus: input.response.status,
        responseOk: input.response.ok,
        responseBodyBytes: input.response.bodyBytes,
        responseTruncated: input.response.truncated,
        responseSchemaValidation: input.response.schemaValidation,
      },
    );
    return {
      payloadStoreReference: jobPayloadStoreReference(completed),
      result: readbackResult(completed, "completed", {
        response: input.response,
      }),
    };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function failToolOperationDispatchRequest(
  input: FailToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestReadbackResult> {
  assertScope(input.subject, "tools:manage");
  const result = await input.repository.transaction(async (repository) => {
    const job = await findClaimedDispatchRequest(
      repository,
      input.subject,
      input.jobId,
    );
    const now = new Date().toISOString();
    const failed = await repository.updateBackgroundJob({
      ...job,
      status: "failed",
      payload: {
        ...job.payload,
        errorCode: input.errorCode,
        workerFailedAt: now,
        workerId: input.subject.id,
      },
      updatedAt: now,
      completedAt: now,
    });
    await auditDispatchRequestReadback(
      repository,
      input.subject,
      failed,
      "tool.operation.dispatch_request.fail",
      "failure",
      {
        errorCode: input.errorCode,
      },
    );
    return {
      payloadStoreReference: jobPayloadStoreReference(failed),
      result: readbackResult(failed, "failed", {
        errorCode: input.errorCode,
      }),
    };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function cancelToolOperationDispatchRequest(
  input: CancelToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestReadbackResult> {
  assertScope(input.subject, "tools:manage");
  const result = await input.repository.transaction(async (repository) => {
    const job = await findCancellableDispatchRequest(
      repository,
      input.subject,
      input.jobId,
    );
    const now = new Date().toISOString();
    const reasonCode = input.reasonCode ?? "operator_cancelled";
    const cancelled = await repository.updateBackgroundJob({
      ...job,
      status: "failed",
      payload: {
        ...job.payload,
        cancelledAt: now,
        cancelledBy: input.subject.id,
        cancelReasonCode: reasonCode,
        errorCode: "worker_cancelled",
      },
      updatedAt: now,
      completedAt: now,
    });
    await auditDispatchRequestReadback(
      repository,
      input.subject,
      cancelled,
      "tool.operation.dispatch_request.cancel",
      "success",
      {
        errorCode: "worker_cancelled",
        reasonCode,
      },
    );
    return {
      payloadStoreReference: jobPayloadStoreReference(cancelled),
      result: readbackResult(cancelled, "cancelled", {
        errorCode: "worker_cancelled",
      }),
    };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function expireToolOperationDispatchRequests(
  input: ExpireToolOperationDispatchRequestsInput,
): Promise<ToolOperationDispatchRequestExpiryResult> {
  assertScope(input.subject, "tools:manage");
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const result = await input.repository.transaction(async (repository) => {
    const candidates = (
      await repository.listBackgroundJobs(input.subject.orgId)
    )
      .map((job) => dispatchRequestExpirationCandidate(job, input, nowMs))
      .filter((candidate) => candidate !== undefined)
      .sort(
        (left, right) =>
          left.referenceTimeMs - right.referenceTimeMs ||
          left.job.id.localeCompare(right.job.id),
      )
      .slice(0, input.limit);

    const expiredJobs: ToolOperationDispatchRequestExpiryResult["jobs"] = [];
    const payloadStoreReferences: ToolOperationDispatchPayloadStoreReference[] =
      [];
    for (const candidate of candidates) {
      validateDispatchRequestPayload(candidate.job);
      const expiration = expirationPayload(input, candidate, now);
      const expired = await repository.updateBackgroundJob({
        ...candidate.job,
        status: "failed",
        payload: {
          ...candidate.job.payload,
          errorCode: "worker_dispatch_request_expired",
          expiredAt: now,
          expiredBy: input.subject.id,
          expiration,
        },
        updatedAt: now,
        completedAt: now,
      });
      await auditDispatchRequestReadback(
        repository,
        input.subject,
        expired,
        "tool.operation.dispatch_request.expire",
        "failure",
        {
          errorCode: "worker_dispatch_request_expired",
          ...expiration,
        },
      );
      expiredJobs.push(expiryResult(expired, candidate.reasonCode));
      const reference = jobPayloadStoreReference(expired);
      if (reference !== undefined) payloadStoreReferences.push(reference);
    }

    return {
      payloadStoreReferences,
      result: { expired: expiredJobs.length, workerQueue, jobs: expiredJobs },
    };
  });
  await Promise.all(
    result.payloadStoreReferences.map((reference) =>
      deleteDispatchPayloadObject(input.dispatchPayloadStore, reference),
    ),
  );
  return result.result;
}

async function deadLetterDispatchRequest(
  repository: RomeoRepository,
  subject: AuthSubject,
  job: BackgroundJob,
  lease: {
    attempt: number;
    claimedAt: string;
    expiresAt: string;
    leaseSeconds: number;
    renewedAt: string;
    workerId: string;
  },
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  const deadLettered = await repository.updateBackgroundJob({
    ...job,
    status: "failed",
    payload: {
      ...job.payload,
      deadLetter: {
        attempts: dispatchRequestMaxAttempts,
        failedAt: now,
        maxAttempts: dispatchRequestMaxAttempts,
        nextAttempt: lease.attempt,
        reasonCode: "max_attempts_exhausted",
        workerId: subject.id,
      },
      errorCode: "worker_attempts_exhausted",
      workerFailedAt: now,
      workerId: subject.id,
    },
    updatedAt: now,
    completedAt: now,
  });
  await auditDispatchRequestReadback(
    repository,
    subject,
    deadLettered,
    "tool.operation.dispatch_request.dead_letter",
    "failure",
    {
      attempts: dispatchRequestMaxAttempts,
      errorCode: "worker_attempts_exhausted",
      maxAttempts: dispatchRequestMaxAttempts,
      nextAttempt: lease.attempt,
      reasonCode: "max_attempts_exhausted",
    },
  );
  return deadLettered;
}

interface DispatchRequestExpirationCandidate {
  ageSeconds: number;
  job: BackgroundJob;
  leaseExpiredSeconds?: number;
  reasonCode: ToolOperationDispatchRequestExpiryReason;
  referenceTimeMs: number;
  workerId?: string;
}

function dispatchRequestExpirationCandidate(
  job: BackgroundJob,
  input: ExpireToolOperationDispatchRequestsInput,
  nowMs: number,
): DispatchRequestExpirationCandidate | undefined {
  if (job.type !== dispatchRequestType) return undefined;
  if (job.status === "completed" || job.status === "failed") return undefined;

  if (job.status === "queued") {
    const createdAtMs = Date.parse(job.createdAt);
    if (!Number.isFinite(createdAtMs)) return undefined;
    const ageSeconds = Math.floor((nowMs - createdAtMs) / 1000);
    if (ageSeconds < input.queuedTimeoutSeconds) return undefined;
    return {
      ageSeconds,
      job,
      reasonCode: "queued_timeout",
      referenceTimeMs: createdAtMs,
    };
  }

  const lease = readWorkerLease(job);
  if (lease === undefined) return undefined;
  const leaseExpiresAtMs = Date.parse(lease.expiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) return undefined;
  const leaseExpiredSeconds = Math.floor((nowMs - leaseExpiresAtMs) / 1000);
  if (leaseExpiredSeconds < input.runningTimeoutSeconds) return undefined;
  const createdAtMs = Date.parse(job.createdAt);
  return {
    ageSeconds: Number.isFinite(createdAtMs)
      ? Math.floor((nowMs - createdAtMs) / 1000)
      : 0,
    job,
    leaseExpiredSeconds,
    reasonCode: "running_lease_timeout",
    referenceTimeMs: leaseExpiresAtMs,
    workerId: lease.workerId,
  };
}

function expirationPayload(
  input: ExpireToolOperationDispatchRequestsInput,
  candidate: DispatchRequestExpirationCandidate,
  expiredAt: string,
): Record<string, unknown> {
  return {
    ageSeconds: candidate.ageSeconds,
    expiredAt,
    expiredBy: input.subject.id,
    reasonCode: candidate.reasonCode,
    ...(candidate.reasonCode === "queued_timeout"
      ? { queuedTimeoutSeconds: input.queuedTimeoutSeconds }
      : {}),
    ...(candidate.reasonCode === "running_lease_timeout"
      ? { runningTimeoutSeconds: input.runningTimeoutSeconds }
      : {}),
    ...(candidate.leaseExpiredSeconds === undefined
      ? {}
      : { leaseExpiredSeconds: candidate.leaseExpiredSeconds }),
    ...(candidate.workerId === undefined
      ? {}
      : { workerId: candidate.workerId }),
  };
}

async function findClaimedDispatchRequest(
  repository: RomeoRepository,
  subject: AuthSubject,
  jobId: string,
): Promise<BackgroundJob> {
  const job = (await repository.listBackgroundJobs(subject.orgId)).find(
    (item) => item.id === jobId,
  );
  if (job === undefined || job.type !== dispatchRequestType)
    throw notFound("Tool operation dispatch request");
  if (job.status !== "running") {
    throw new ApiError(
      "tool_operation_dispatch_request_not_claimed",
      "Tool operation dispatch request is not claimed by this worker.",
      409,
      {
        status: job.status,
      },
    );
  }
  validateDispatchRequestPayload(job);
  const lease = readWorkerLease(job);
  if (
    lease === undefined ||
    lease.workerId !== subject.id ||
    Date.parse(lease.expiresAt) <= Date.now()
  ) {
    throw new ApiError(
      "tool_operation_dispatch_request_lease_invalid",
      "Tool operation dispatch request lease is invalid or expired.",
      409,
    );
  }
  return job;
}

async function findCancellableDispatchRequest(
  repository: RomeoRepository,
  subject: AuthSubject,
  jobId: string,
): Promise<BackgroundJob> {
  const job = (await repository.listBackgroundJobs(subject.orgId)).find(
    (item) => item.id === jobId,
  );
  if (job === undefined || job.type !== dispatchRequestType)
    throw notFound("Tool operation dispatch request");
  if (job.status === "completed" || job.status === "failed") {
    throw new ApiError(
      "tool_operation_dispatch_request_terminal",
      "Tool operation dispatch request is already terminal.",
      409,
      {
        status: job.status,
      },
    );
  }
  validateDispatchRequestPayload(job);
  return job;
}

async function auditDispatchRequestReadback(
  repository: RomeoRepository,
  subject: AuthSubject,
  job: BackgroundJob,
  action: string,
  outcome: "failure" | "success",
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action,
    resourceType: "tool_operation",
    resourceId: payloadString(job, "operationId"),
    outcome,
    metadata: {
      jobId: job.id,
      connectorId: payloadString(job, "connectorId"),
      operationId: payloadString(job, "operationId"),
      method: payloadString(job, "method"),
      path: payloadString(job, "path"),
      workerQueue,
      host: payloadString(job, "host"),
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      payloadStorage: jobPayloadStorage(job),
      ...metadata,
    },
  });
}

function readbackResult(
  job: BackgroundJob,
  outcome: "cancelled" | "completed" | "failed",
  result:
    | { errorCode: string }
    | { response: ToolOperationDispatchReadbackResponse },
): ToolOperationDispatchRequestReadbackResult {
  return {
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue,
    outcome,
    ...result,
  };
}

function payloadResult(
  job: BackgroundJob,
  payload: ToolDispatchPayload,
): ToolOperationDispatchRequestPayloadResult {
  return {
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue,
    request: {
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      host: payloadString(job, "host"),
      payloadStorage: jobPayloadStorage(job),
    },
    payload,
  };
}

function expiryResult(
  job: BackgroundJob,
  reasonCode: ToolOperationDispatchRequestExpiryReason,
): ToolOperationDispatchRequestExpiryResult["jobs"][number] {
  return {
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    reasonCode,
  };
}

async function claimResult(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolOperationDispatchRequestClaimResult> {
  const lease = readWorkerLease(job);
  if (lease === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_request_lease_invalid",
      "Tool operation dispatch request lease is invalid or expired.",
      409,
    );
  }
  const responseValidation = await responseValidationPlan(repository, job);
  const authPolicy = await dispatchAuthPolicy(repository, job);
  const payloadStore = jobPayloadStoreReference(job);
  const transport = jobTransport(job);
  return {
    claimed: true,
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue,
    request: {
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      host: payloadString(job, "host"),
      payloadStorage: jobPayloadStorage(job),
    },
    ...(payloadStore === undefined ? {} : { payloadStore }),
    lease,
    ...(authPolicy === undefined ? {} : { authPolicy }),
    ...(responseValidation === undefined ? {} : { responseValidation }),
    ...(transport === undefined ? {} : { transport }),
  };
}

async function dispatchAuthPolicy(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolOperationDispatchRequestClaimResult["authPolicy"]> {
  const connector = await dispatchConnector(repository, job);
  if (connector === undefined) return undefined;
  const type =
    typeof connector.authConfig.type === "string"
      ? connector.authConfig.type
      : "none";
  if (
    type !== "none" &&
    type !== "api_key" &&
    type !== "bearer" &&
    type !== "oauth2_client_credentials"
  ) {
    return { type: "none" };
  }
  if (type !== "oauth2_client_credentials") return { type };
  const tokenUrl =
    typeof connector.authConfig.oauthTokenUrl === "string"
      ? connector.authConfig.oauthTokenUrl
      : undefined;
  if (tokenUrl === undefined) return { type };
  const scopes = Array.isArray(connector.authConfig.oauthScopes)
    ? connector.authConfig.oauthScopes.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const clientAuthMethod =
    connector.authConfig.oauthClientAuthMethod === "client_secret_post"
      ? "client_secret_post"
      : "client_secret_basic";
  return {
    type,
    oauthTokenUrl: tokenUrl,
    oauthScopes: scopes,
    oauthClientAuthMethod: clientAuthMethod,
  };
}

async function responseValidationPlan(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolOperationDispatchRequestClaimResult["responseValidation"]> {
  const connectorId = payloadString(job, "connectorId");
  const operationId = payloadString(job, "operationId");
  const operation = (await repository.listToolOperations(connectorId)).find(
    (item) => item.operationId === operationId,
  );
  if (operation === undefined) return undefined;
  const jsonSchemas = responseJsonSchemas(operation);
  return Object.keys(jsonSchemas).length === 0 ? undefined : { jsonSchemas };
}

async function dispatchConnector(
  repository: RomeoRepository,
  job: BackgroundJob,
): Promise<ToolConnector | undefined> {
  const connectorId = payloadString(job, "connectorId");
  return (await repository.listToolConnectors(job.orgId)).find(
    (item) => item.id === connectorId,
  );
}

function responseJsonSchemas(
  operation: ToolOperation,
): Record<string, Record<string, unknown>> {
  const responses = asRecord(operation.outputSchema);
  if (responses === undefined) return {};
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const [status, responseValue] of Object.entries(responses)) {
    if (!/^(default|[1-5][0-9][0-9])$/u.test(status)) continue;
    const response = asRecord(responseValue);
    const content = asRecord(response?.content);
    if (content === undefined) continue;
    const jsonContent =
      asRecord(content["application/json"]) ??
      asRecord(
        Object.entries(content).find(([mediaType]) =>
          isJsonContentType(mediaType),
        )?.[1],
      );
    const schema = validationSchemaSubset(asRecord(jsonContent?.schema), 0);
    if (schema !== undefined) schemas[status] = schema;
  }
  return schemas;
}

function validationSchemaSubset(
  schema: Record<string, unknown> | undefined,
  depth: number,
): Record<string, unknown> | undefined {
  if (schema === undefined || depth > 6) return undefined;
  const output: Record<string, unknown> = {};
  if (typeof schema.type === "string") output.type = schema.type;
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter(
      (item): item is string => typeof item === "string",
    );
    if (types.length > 0) output.type = types;
  }
  if (Array.isArray(schema.enum)) output.enum = schema.enum;
  if (Array.isArray(schema.required)) {
    const required = schema.required.filter(
      (item): item is string => typeof item === "string",
    );
    if (required.length > 0) output.required = required;
  }
  const properties = asRecord(schema.properties);
  if (properties !== undefined) {
    const propertySchemas: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const child = validationSchemaSubset(asRecord(value), depth + 1);
      if (child !== undefined) propertySchemas[key] = child;
    }
    if (Object.keys(propertySchemas).length > 0)
      output.properties = propertySchemas;
  }
  const items = validationSchemaSubset(asRecord(schema.items), depth + 1);
  if (items !== undefined) output.items = items;
  return Object.keys(output).length === 0 ? undefined : output;
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === "application/json" || normalized.endsWith("+json");
}

function validateDispatchRequestPayload(job: BackgroundJob): void {
  payloadString(job, "connectorId");
  payloadString(job, "operationId");
  payloadString(job, "method");
  payloadString(job, "path");
  payloadString(job, "host");
  payloadStringArray(job, "parameterKeys");
  payloadStringArray(job, "bodyKeys");
  jobPayloadStorage(job);
  jobPayloadStoreReference(job);
  jobTransport(job);
}

function jobTransport(
  job: BackgroundJob,
): ToolOperationDispatchTransport | undefined {
  const value = job.payload.transport;
  if (value === undefined) return undefined;
  const transport = asRecord(value);
  if (transport === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_request_invalid",
      "Tool operation dispatch request metadata is invalid.",
      409,
      { key: "transport" },
    );
  }
  if (
    transport.protocol === "mcp_streamable_http" &&
    transport.requestBody === "mcp_tools_call" &&
    typeof transport.mcpToolName === "string" &&
    /^[A-Za-z0-9_.:/-]{1,120}$/u.test(transport.mcpToolName) &&
    typeof transport.mcpProtocolVersion === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(transport.mcpProtocolVersion)
  ) {
    return {
      protocol: "mcp_streamable_http",
      requestBody: "mcp_tools_call",
      mcpToolName: transport.mcpToolName,
      mcpProtocolVersion: transport.mcpProtocolVersion,
    };
  }
  if (transport.protocol === "http" && transport.requestBody === "raw_json") {
    return { protocol: "http", requestBody: "raw_json" };
  }
  throw new ApiError(
    "tool_operation_dispatch_request_invalid",
    "Tool operation dispatch request metadata is invalid.",
    409,
    { key: "transport" },
  );
}

function jobPayloadStorage(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStorage {
  const value = job.payload.payloadStorage;
  if (value === undefined) return "external_worker_secret_store_required";
  if (
    value === "external_worker_secret_store_required" ||
    value === "managed_encrypted_object_store"
  ) {
    return value;
  }
  throw new ApiError(
    "tool_operation_dispatch_request_invalid",
    "Tool operation dispatch request metadata is invalid.",
    409,
    { key: "payloadStorage" },
  );
}

function jobPayloadStoreReference(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStoreReference | undefined {
  if (jobPayloadStorage(job) !== "managed_encrypted_object_store")
    return undefined;
  const value = job.payload.payloadStore;
  if (isToolDispatchPayloadStoreReference(value)) return value;
  throw new ApiError(
    "tool_operation_dispatch_request_invalid",
    "Tool operation dispatch request metadata is invalid.",
    409,
    { key: "payloadStore" },
  );
}

async function deleteDispatchPayloadObject(
  payloadStore: ToolDispatchPayloadStore | undefined,
  reference: ToolOperationDispatchPayloadStoreReference | undefined,
): Promise<void> {
  if (payloadStore === undefined || reference === undefined) return;
  try {
    await payloadStore.delete(reference);
  } catch {
    // Encrypted payload buckets should also have lifecycle expiry configured.
  }
}

async function readDispatchPayloadObject(
  payloadStore: ToolDispatchPayloadStore,
  reference: ToolOperationDispatchPayloadStoreReference,
) {
  try {
    const stored = await payloadStore.read(reference);
    if (stored !== undefined) return stored;
  } catch {
    throw new ApiError(
      "tool_operation_dispatch_payload_unavailable",
      "Tool operation dispatch payload is unavailable.",
      409,
    );
  }
  throw new ApiError(
    "tool_operation_dispatch_payload_unavailable",
    "Tool operation dispatch payload is unavailable.",
    409,
  );
}

function assertPayloadMatchesClaim(
  job: BackgroundJob,
  stored: {
    connectorId: string;
    operationId: string;
    orgId: string;
  },
): void {
  if (
    stored.orgId === job.orgId &&
    stored.connectorId === payloadString(job, "connectorId") &&
    stored.operationId === payloadString(job, "operationId")
  ) {
    return;
  }
  throw new ApiError(
    "tool_operation_dispatch_payload_invalid",
    "Tool operation dispatch payload metadata does not match the claimed job.",
    409,
  );
}

function payloadString(job: BackgroundJob, key: string): string {
  const value = job.payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(
      "tool_operation_dispatch_request_invalid",
      "Tool operation dispatch request metadata is invalid.",
      409,
      { key },
    );
  }
  return value;
}

function payloadStringArray(job: BackgroundJob, key: string): string[] {
  const value = job.payload[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new ApiError(
      "tool_operation_dispatch_request_invalid",
      "Tool operation dispatch request metadata is invalid.",
      409,
      { key },
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readWorkerLease(
  job: BackgroundJob,
): ToolOperationDispatchRequestClaimResult["lease"] | undefined {
  const value = job.payload.workerLease;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const lease = value as ToolOperationDispatchRequestClaimResult["lease"];
  if (
    lease === undefined ||
    typeof lease.workerId !== "string" ||
    typeof lease.claimedAt !== "string" ||
    typeof lease.renewedAt !== "string" ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.leaseSeconds !== "number" ||
    typeof lease.attempt !== "number"
  ) {
    return undefined;
  }
  return lease;
}
