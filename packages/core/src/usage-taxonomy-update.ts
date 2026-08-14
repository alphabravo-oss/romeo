import type { UsageEvent } from "./domain/entities";
import {
  assertUsageEventTaxonomy,
  assertUsageMetadataPrivacy,
} from "./usage-taxonomy-validation";

/**
 * New events must be canonical. Existing pre-taxonomy rows may receive a
 * metadata-only privacy/retention update, but their identity, classification,
 * measurement, and timestamp cannot be rewritten under that exception.
 */
export function assertUsageEventUpdate(
  current: UsageEvent,
  next: UsageEvent,
): "canonical" | "legacy_metadata_only" {
  assertImmutableUsageIdentity(current, next);
  assertUsageMetadataPrivacy(next.metadata);
  let currentIsCanonical = true;
  try {
    assertUsageEventTaxonomy(current);
  } catch {
    currentIsCanonical = false;
  }
  try {
    assertUsageEventTaxonomy(next);
    return "canonical";
  } catch (error) {
    if (currentIsCanonical) throw error;
    if (current.quantity !== next.quantity) throw error;
    return "legacy_metadata_only";
  }
}

function assertImmutableUsageIdentity(
  current: UsageEvent,
  next: UsageEvent,
): void {
  const matches =
    current.id === next.id &&
    current.orgId === next.orgId &&
    current.workspaceId === next.workspaceId &&
    current.actorId === next.actorId &&
    current.sourceType === next.sourceType &&
    current.sourceId === next.sourceId &&
    current.metric === next.metric &&
    current.unit === next.unit &&
    current.createdAt === next.createdAt;
  if (!matches)
    throw new TypeError(
      "Usage event identity and classification are immutable.",
    );
}
