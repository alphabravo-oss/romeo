export interface RuntimeKeyUsageQuery {
  activeVersion?: string;
  orgId?: string;
  previousVersion?: string;
}

export interface RuntimeKeyUsageCounts {
  active: number;
  corrupt: number;
  legacyUnversioned: number;
  previous: number;
  total: number;
  unknown: number;
}

export type RuntimeKeyUsageClassification =
  | "active"
  | "corrupt"
  | "legacyUnversioned"
  | "previous"
  | "unknown";

const versionPattern = /^[a-f0-9]{16}$/u;

export function emptyRuntimeKeyUsageCounts(): RuntimeKeyUsageCounts {
  return {
    active: 0,
    corrupt: 0,
    legacyUnversioned: 0,
    previous: 0,
    total: 0,
    unknown: 0,
  };
}

export function classifyDelegatedOAuthTokenEnvelope(
  value: unknown,
  query: Omit<RuntimeKeyUsageQuery, "orgId">,
): RuntimeKeyUsageClassification {
  if (!isRecord(value) || !validEnvelopeFields(value)) return "corrupt";
  if (value.v === 1 || value.v === 2) return "legacyUnversioned";
  if (value.v !== 3 || !isRuntimeKeyVersion(value.keyVersion)) return "corrupt";
  return classifyVersion(value.keyVersion, query);
}

export function classifyWebhookSigningKeyVersion(
  value: unknown,
  query: Omit<RuntimeKeyUsageQuery, "orgId">,
): RuntimeKeyUsageClassification {
  if (value === undefined || value === null) return "legacyUnversioned";
  if (!isRuntimeKeyVersion(value)) return "corrupt";
  return classifyVersion(value, query);
}

export function accumulateRuntimeKeyUsage(
  counts: RuntimeKeyUsageCounts,
  classification: RuntimeKeyUsageClassification,
): void {
  counts[classification] += 1;
  counts.total += 1;
}

export function isRuntimeKeyVersion(value: unknown): value is string {
  return typeof value === "string" && versionPattern.test(value);
}

function classifyVersion(
  version: string,
  query: Omit<RuntimeKeyUsageQuery, "orgId">,
): RuntimeKeyUsageClassification {
  if (version === query.activeVersion) return "active";
  if (version === query.previousVersion) return "previous";
  return "unknown";
}

function validEnvelopeFields(value: Record<string, unknown>): boolean {
  return (
    value.alg === "A256GCM" &&
    typeof value.iv === "string" &&
    value.iv.length > 0 &&
    typeof value.ciphertext === "string" &&
    value.ciphertext.length > 0 &&
    typeof value.tag === "string" &&
    value.tag.length > 0 &&
    typeof value.createdAt === "string" &&
    value.createdAt.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
