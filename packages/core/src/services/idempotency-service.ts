import type { AuthSubject } from "@romeo/auth";
import { createHash } from "node:crypto";

import type { IdempotencyReceipt } from "../domain/idempotency";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { idempotencyUsageStore } from "./idempotency-observability";

export type IdempotentOperation =
  | "images.generate"
  | "runs.start"
  | "exports.execute"
  | "compare.sessions.start"
  | "compute.jobs.create"
  | "media.jobs.create"
  | "table.exports.create";

export interface IdempotencyMetadata {
  expiresAt: string;
  receiptId: string;
  replayed: boolean;
}

export class IdempotencyService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: { leaseMs?: number; ttlMs?: number } = {},
  ) {}

  cleanupExpired(limit = 500): Promise<number> {
    return this.repository.deleteExpiredIdempotencyReceipts({
      before: new Date().toISOString(),
      limit: Math.max(1, Math.min(1_000, limit)),
    });
  }

  async execute<T>(input: {
    subject: AuthSubject;
    operation: IdempotentOperation;
    key?: string;
    request: unknown;
    responseStatus: number;
    work: (context?: { receiptId: string }) => Promise<T>;
  }): Promise<{ value: T; idempotency?: IdempotencyMetadata }> {
    if (input.key === undefined) return { value: await input.work() };
    const claim = await this.claim(input);
    if (claim.outcome === "replay") {
      if (
        claim.receipt.responseStatus !== input.responseStatus ||
        claim.receipt.responseBody === undefined
      )
        throw new ApiError(
          "idempotency_receipt_invalid",
          "The stored idempotency receipt cannot be replayed safely.",
          500,
        );
      return {
        value: claim.receipt.responseBody as T,
        idempotency: metadata(claim.receipt, true),
      };
    }
    if (claim.outcome === "conflict")
      throw new ApiError(
        "idempotency_key_conflict",
        "The idempotency key was already used for a different request.",
        409,
      );
    if (claim.outcome === "in_progress")
      throw new ApiError(
        "idempotency_request_in_progress",
        "The idempotent request is still in progress. Retry later.",
        409,
      );
    if (claim.outcome === "failed")
      throw new ApiError(
        "idempotency_request_failed",
        "The prior idempotent request reached a terminal failure. Use a new key.",
        409,
      );
    const leaseToken = claim.receipt.leaseToken;
    if (leaseToken === undefined)
      throw new Error("Owned receipt is missing its lease token.");
    try {
      const value = await input.work({ receiptId: claim.receipt.id });
      assertBoundedResponse(value);
      const completed = await this.repository.completeIdempotencyReceipt({
        id: claim.receipt.id,
        orgId: input.subject.orgId,
        leaseToken,
        now: new Date().toISOString(),
        responseStatus: input.responseStatus,
        responseBody: value,
      });
      if (completed === undefined)
        throw new ApiError(
          "idempotency_lease_lost",
          "The idempotent request lease was lost before completion.",
          409,
        );
      return { value, idempotency: metadata(completed, false) };
    } catch (caught) {
      await this.repository.failIdempotencyReceipt({
        id: claim.receipt.id,
        orgId: input.subject.orgId,
        leaseToken,
        now: new Date().toISOString(),
        errorCode: caught instanceof ApiError ? caught.code : "internal_error",
      });
      throw caught;
    }
  }

  private async claim(input: {
    subject: AuthSubject;
    operation: IdempotentOperation;
    key?: string;
    request: unknown;
  }) {
    const key = normalizedKey(input.key);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const receipt: IdempotencyReceipt = {
      id: createId("idempotency_receipt"),
      orgId: input.subject.orgId,
      actorType: input.subject.type,
      actorId: input.subject.id,
      credentialHash: credentialHash(input.subject),
      operation: input.operation,
      keyHash: sha256(key),
      requestHash: sha256(canonicalJson(input.request)),
      state: "in_progress",
      leaseToken: createId("idempotency_lease"),
      leaseExpiresAt: new Date(
        nowMs + (this.options.leaseMs ?? 15 * 60_000),
      ).toISOString(),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(
        nowMs + (this.options.ttlMs ?? 24 * 60 * 60_000),
      ).toISOString(),
    };
    const claim = await this.repository.claimIdempotencyReceipt({
      receipt,
      now,
    });
    idempotencyUsageStore.record(input.operation, claim.outcome);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "idempotency.receipt.claim",
      resourceType: "idempotency_receipt",
      resourceId: claim.receipt.id,
      metadata: { operation: input.operation, outcome: claim.outcome },
    });
    return claim;
  }
}

export function resolveIdempotencyKey(
  header: string | undefined,
  body: string | undefined,
): string | undefined {
  if (
    header !== undefined &&
    body !== undefined &&
    header.trim() !== body.trim()
  )
    throw new ApiError(
      "idempotency_key_mismatch",
      "The header and body idempotency keys must match.",
      400,
    );
  const value = header ?? body;
  return value === undefined ? undefined : normalizedKey(value);
}

function normalizedKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (key.length === 0 || key.length > 200)
    throw new ApiError(
      "idempotency_key_invalid",
      "Idempotency-Key must contain between 1 and 200 characters.",
      400,
    );
  return key;
}

function metadata(
  receipt: IdempotencyReceipt,
  replayed: boolean,
): IdempotencyMetadata {
  return { receiptId: receipt.id, expiresAt: receipt.expiresAt, replayed };
}

function credentialHash(subject: AuthSubject): string {
  const credential =
    subject.apiKeyId === undefined
      ? subject.sessionId === undefined
        ? "principal"
        : `session:${subject.sessionId}`
      : `api_key:${subject.apiKeyId}`;
  return sha256(`${subject.type}\u0000${subject.id}\u0000${credential}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertBoundedResponse(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 128 * 1024)
    throw new ApiError(
      "idempotency_response_too_large",
      "The command response is too large for durable replay.",
      500,
    );
}
