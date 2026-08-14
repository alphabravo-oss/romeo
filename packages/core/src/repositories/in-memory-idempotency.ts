import type * as I from "../domain/idempotency";
import { InMemoryCapabilityFlagRepository } from "./in-memory-capability-flags";

export abstract class InMemoryIdempotencyRepository extends InMemoryCapabilityFlagRepository {
  async claimIdempotencyReceipt(
    input: I.ClaimIdempotencyReceiptInput,
  ): Promise<I.ClaimIdempotencyReceiptResult> {
    const candidate = input.receipt;
    const current = this.data.idempotencyReceipts.find(
      (receipt) =>
        receipt.orgId === candidate.orgId &&
        receipt.actorType === candidate.actorType &&
        receipt.actorId === candidate.actorId &&
        receipt.credentialHash === candidate.credentialHash &&
        receipt.operation === candidate.operation &&
        receipt.keyHash === candidate.keyHash,
    );
    if (current === undefined) {
      this.data.idempotencyReceipts.push(structuredClone(candidate));
      return { outcome: "owner", receipt: structuredClone(candidate) };
    }
    if (current.requestHash !== candidate.requestHash)
      return { outcome: "conflict", receipt: structuredClone(current) };
    if (current.state === "completed")
      return { outcome: "replay", receipt: structuredClone(current) };
    if (current.state === "failed")
      return { outcome: "failed", receipt: structuredClone(current) };
    if (
      current.leaseExpiresAt !== undefined &&
      current.leaseExpiresAt > input.now
    )
      return { outcome: "in_progress", receipt: structuredClone(current) };
    Object.assign(current, {
      leaseToken: candidate.leaseToken,
      leaseExpiresAt: candidate.leaseExpiresAt,
      expiresAt: candidate.expiresAt,
      updatedAt: input.now,
    });
    return { outcome: "owner", receipt: structuredClone(current) };
  }

  async completeIdempotencyReceipt(
    input: I.CompleteIdempotencyReceiptInput,
  ): Promise<I.IdempotencyReceipt | undefined> {
    const receipt = this.ownedReceipt(input);
    if (receipt === undefined) return undefined;
    Object.assign(receipt, {
      state: "completed" as const,
      responseStatus: input.responseStatus,
      responseBody: structuredClone(input.responseBody),
      updatedAt: input.now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    return structuredClone(receipt);
  }

  async failIdempotencyReceipt(
    input: I.FailIdempotencyReceiptInput,
  ): Promise<I.IdempotencyReceipt | undefined> {
    const receipt = this.ownedReceipt(input);
    if (receipt === undefined) return undefined;
    Object.assign(receipt, {
      state: "failed" as const,
      errorCode: input.errorCode,
      updatedAt: input.now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    return structuredClone(receipt);
  }

  async deleteExpiredIdempotencyReceipts(input: {
    before: string;
    limit: number;
  }): Promise<number> {
    const ids = this.data.idempotencyReceipts
      .filter(
        (receipt) =>
          receipt.expiresAt < input.before &&
          (receipt.state !== "in_progress" ||
            receipt.leaseExpiresAt === undefined ||
            receipt.leaseExpiresAt <= input.before),
      )
      .sort(
        (left, right) =>
          left.expiresAt.localeCompare(right.expiresAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(0, input.limit))
      .map((receipt) => receipt.id);
    const selected = new Set(ids);
    this.data.idempotencyReceipts = this.data.idempotencyReceipts.filter(
      (receipt) => !selected.has(receipt.id),
    );
    return ids.length;
  }

  private ownedReceipt(input: {
    id: string;
    orgId: string;
    leaseToken: string;
  }): I.IdempotencyReceipt | undefined {
    return this.data.idempotencyReceipts.find(
      (receipt) =>
        receipt.id === input.id &&
        receipt.orgId === input.orgId &&
        receipt.state === "in_progress" &&
        receipt.leaseToken === input.leaseToken,
    );
  }
}
