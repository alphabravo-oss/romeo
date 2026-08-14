import type { UsageEvent } from "./domain/entities";
import {
  isPrivacySafeMetadataKey,
  isPrivacySafeMetadataValue,
} from "./metadata-privacy";
import {
  USAGE_METRIC_DEFINITIONS,
  type UsageMetricCode,
} from "./usage-taxonomy";

const FRACTIONAL_USAGE_UNITS = new Set(["second", "token_per_second"]);

export function isUsageMetricCode(value: string): value is UsageMetricCode {
  return Object.hasOwn(USAGE_METRIC_DEFINITIONS, value);
}

export function assertUsageEventTaxonomy(
  event: Pick<
    UsageEvent,
    "metadata" | "metric" | "quantity" | "sourceType" | "unit"
  >,
): asserts event is Pick<
  UsageEvent,
  "metadata" | "metric" | "quantity" | "sourceType" | "unit"
> & { metric: UsageMetricCode } {
  assertUsageMetadataPrivacy(event.metadata);
  if (!isUsageMetricCode(event.metric))
    throw new Error(`Unregistered usage metric: ${event.metric}`);
  const definition = USAGE_METRIC_DEFINITIONS[event.metric];
  if (event.unit !== definition.unit)
    throw new Error(
      `Usage metric ${event.metric} requires unit ${definition.unit}.`,
    );
  if (!(definition.sourceTypes as readonly string[]).includes(event.sourceType))
    throw new Error(
      `Usage metric ${event.metric} does not allow source type ${event.sourceType}.`,
    );
  if (!Number.isFinite(event.quantity) || event.quantity < 0)
    throw new Error(
      `Usage metric ${event.metric} requires a finite nonnegative quantity.`,
    );
  if (
    !FRACTIONAL_USAGE_UNITS.has(definition.unit) &&
    !Number.isSafeInteger(event.quantity)
  )
    throw new Error(
      `Usage metric ${event.metric} requires a nonnegative safe-integer quantity.`,
    );
}

export function assertUsageMetadataPrivacy(
  metadata: Record<string, unknown>,
): void {
  const entries = Object.entries(metadata);
  if (entries.length > 100)
    throw new TypeError("Usage metadata exceeds the key limit.");
  for (const [key, value] of entries) {
    if (!isPrivacySafeMetadataKey(key))
      throw new TypeError("Usage metadata contains a forbidden key.");
    if (!isPrivacySafeMetadataValue(value))
      throw new TypeError("Usage metadata value is invalid.");
  }
}
