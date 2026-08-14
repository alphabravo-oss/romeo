import type {
  ClaimIdempotencyReceiptInput,
  ClaimIdempotencyReceiptResult,
  CompleteIdempotencyReceiptInput,
  FailIdempotencyReceiptInput,
  IdempotencyReceipt,
} from "./idempotency";

export interface RepositoryIdempotency {
  claimIdempotencyReceipt(
    input: ClaimIdempotencyReceiptInput,
  ): Promise<ClaimIdempotencyReceiptResult>;
  completeIdempotencyReceipt(
    input: CompleteIdempotencyReceiptInput,
  ): Promise<IdempotencyReceipt | undefined>;
  failIdempotencyReceipt(
    input: FailIdempotencyReceiptInput,
  ): Promise<IdempotencyReceipt | undefined>;
  deleteExpiredIdempotencyReceipts(input: {
    before: string;
    limit: number;
  }): Promise<number>;
}
