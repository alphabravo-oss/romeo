import { assertScope, type AuthSubject } from "@romeo/auth";

import type { ToolOperationDispatchReadbackResponse } from "../domain/tools";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import type { SecretResolver } from "./secret-resolver";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";
import {
  dispatchToolOperation,
  enqueueToolOperationDispatch,
} from "./tool-operation-dispatch";
import {
  cancelToolOperationDispatchRequest,
  claimToolOperationDispatchRequest,
  completeToolOperationDispatchRequest,
  expireToolOperationDispatchRequests,
  failToolOperationDispatchRequest,
  readToolOperationDispatchRequestPayload,
  renewToolOperationDispatchRequestLease,
} from "./tool-operation-dispatch-requests";

export interface ToolConnectorDispatchOptions {
  dispatchPayloadStore?: ToolDispatchPayloadStore;
  externalOperationExecutionEnabled?: boolean;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

export class ToolConnectorDispatchService {
  constructor(
    protected readonly repository: RomeoRepository,
    protected readonly secretResolver: SecretResolver,
    protected readonly dispatchOptions: ToolConnectorDispatchOptions = {},
  ) {}

  async dispatchOperation(input: {
    approvalRequestId?: string;
    approved?: boolean;
    subject: AuthSubject;
    connectorId: string;
    operationId: string;
    parameters?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }) {
    const { connector, operation } = await this.operationForInput(input);
    return dispatchToolOperation({
      repository: this.repository,
      secretResolver: this.secretResolver,
      externalExecutionEnabled:
        this.dispatchOptions.externalOperationExecutionEnabled === true,
      fetchImpl: this.dispatchOptions.fetchImpl ?? fetch,
      timeoutMs: this.dispatchOptions.timeoutMs ?? 10_000,
      maxBytes: this.dispatchOptions.maxBytes ?? 1_000_000,
      subject: input.subject,
      connector,
      operation,
      ...(input.approved === undefined ? {} : { approved: input.approved }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      ...(input.parameters === undefined
        ? {}
        : { parameters: input.parameters }),
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  async enqueueDispatchOperation(input: {
    approvalRequestId?: string;
    approved?: boolean;
    idempotencyKey?: string;
    subject: AuthSubject;
    connectorId: string;
    operationId: string;
    parameters?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }) {
    const { connector, operation } = await this.operationForInput(input);
    return enqueueToolOperationDispatch({
      repository: this.repository,
      secretResolver: this.secretResolver,
      externalExecutionEnabled:
        this.dispatchOptions.externalOperationExecutionEnabled === true,
      fetchImpl: this.dispatchOptions.fetchImpl ?? fetch,
      timeoutMs: this.dispatchOptions.timeoutMs ?? 10_000,
      maxBytes: this.dispatchOptions.maxBytes ?? 1_000_000,
      subject: input.subject,
      connector,
      operation,
      ...(this.dispatchOptions.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.dispatchOptions.dispatchPayloadStore }),
      ...(input.approved === undefined ? {} : { approved: input.approved }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
      ...(input.parameters === undefined
        ? {}
        : { parameters: input.parameters }),
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  async claimDispatchRequest(input: {
    leaseSeconds: number;
    payloadStorage?:
      | "external_worker_secret_store_required"
      | "managed_encrypted_object_store";
    subject: AuthSubject;
  }) {
    return claimToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      leaseSeconds: input.leaseSeconds,
      ...(input.payloadStorage === undefined
        ? {}
        : { payloadStorage: input.payloadStorage }),
      ...this.payloadStoreOption(),
    });
  }

  async readDispatchRequestPayload(input: {
    subject: AuthSubject;
    jobId: string;
  }) {
    return readToolOperationDispatchRequestPayload({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      ...this.payloadStoreOption(),
    });
  }

  async renewDispatchRequestLease(input: {
    subject: AuthSubject;
    jobId: string;
    leaseSeconds: number;
  }) {
    return renewToolOperationDispatchRequestLease({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      leaseSeconds: input.leaseSeconds,
    });
  }

  async completeDispatchRequest(input: {
    subject: AuthSubject;
    jobId: string;
    response: ToolOperationDispatchReadbackResponse;
  }) {
    return completeToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      response: input.response,
      ...this.payloadStoreOption(),
    });
  }

  async failDispatchRequest(input: {
    subject: AuthSubject;
    jobId: string;
    errorCode: string;
  }) {
    return failToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      errorCode: input.errorCode,
      ...this.payloadStoreOption(),
    });
  }

  async cancelDispatchRequest(input: {
    subject: AuthSubject;
    jobId: string;
    reasonCode?: string;
  }) {
    return cancelToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      ...this.payloadStoreOption(),
      ...(input.reasonCode === undefined
        ? {}
        : { reasonCode: input.reasonCode }),
    });
  }

  async expireDispatchRequests(input: {
    subject: AuthSubject;
    queuedTimeoutSeconds: number;
    runningTimeoutSeconds: number;
    limit: number;
  }) {
    return expireToolOperationDispatchRequests({
      repository: this.repository,
      subject: input.subject,
      queuedTimeoutSeconds: input.queuedTimeoutSeconds,
      runningTimeoutSeconds: input.runningTimeoutSeconds,
      limit: input.limit,
      ...this.payloadStoreOption(),
    });
  }

  private async operationForInput(input: {
    subject: AuthSubject;
    connectorId: string;
    operationId: string;
  }) {
    assertScope(input.subject, "tools:manage");
    const connector = (
      await this.repository.listToolConnectors(input.subject.orgId)
    ).find((item) => item.id === input.connectorId);
    if (!connector) throw notFound("Tool connector");
    const operation = (
      await this.repository.listToolOperations(connector.id)
    ).find((item) => item.operationId === input.operationId);
    if (!operation) throw notFound("Tool operation");
    return { connector, operation };
  }

  private payloadStoreOption(): {
    dispatchPayloadStore?: ToolDispatchPayloadStore;
  } {
    return this.dispatchOptions.dispatchPayloadStore === undefined
      ? {}
      : { dispatchPayloadStore: this.dispatchOptions.dispatchPayloadStore };
  }
}
