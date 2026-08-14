export type IdempotencyReceiptState = "in_progress" | "completed" | "failed";

export interface IdempotencyReceipt {
  id: string;
  orgId: string;
  actorType: "service_account" | "user";
  actorId: string;
  credentialHash: string;
  operation: string;
  keyHash: string;
  requestHash: string;
  state: IdempotencyReceiptState;
  leaseToken?: string;
  leaseExpiresAt?: string;
  responseStatus?: number;
  responseBody?: unknown;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ClaimIdempotencyReceiptInput {
  receipt: IdempotencyReceipt;
  now: string;
}

export type ClaimIdempotencyReceiptResult =
  | { outcome: "owner"; receipt: IdempotencyReceipt }
  | { outcome: "replay"; receipt: IdempotencyReceipt }
  | { outcome: "conflict"; receipt: IdempotencyReceipt }
  | { outcome: "in_progress"; receipt: IdempotencyReceipt }
  | { outcome: "failed"; receipt: IdempotencyReceipt };

export interface CompleteIdempotencyReceiptInput {
  id: string;
  orgId: string;
  leaseToken: string;
  now: string;
  responseStatus: number;
  responseBody: unknown;
}

export interface FailIdempotencyReceiptInput {
  id: string;
  orgId: string;
  leaseToken: string;
  now: string;
  errorCode: string;
}
