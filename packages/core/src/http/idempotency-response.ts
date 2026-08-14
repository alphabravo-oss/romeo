import type { IdempotencyMetadata } from "../services/idempotency-service";

export function applyIdempotencyHeaders(
  context: { header(name: string, value: string): unknown },
  metadata: IdempotencyMetadata | undefined,
): void {
  if (metadata === undefined) return;
  context.header("Idempotency-Replayed", String(metadata.replayed));
  context.header("Idempotency-Receipt-Expires-At", metadata.expiresAt);
}
