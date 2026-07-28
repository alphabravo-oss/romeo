import type { AuthSubject } from "@romeo/auth";

import type {
  ToolOperationDispatchPayloadStorage,
  ToolOperationDispatchReadbackResponse,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

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

export const dispatchRequestType = "tool.operation.dispatch_request";
export const dispatchRequestMaxAttempts = 3;
export const workerQueue = "external_tool_operations" as const;
