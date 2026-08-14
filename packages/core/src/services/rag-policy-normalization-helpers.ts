import { ragPolicyTiers, type RagPolicyTier } from "../domain/rag-policy";

export function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function isRagPolicyTier(value: unknown): value is RagPolicyTier {
  return (
    typeof value === "string" &&
    (ragPolicyTiers as readonly string[]).includes(value)
  );
}
