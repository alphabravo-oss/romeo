import { createHash } from "node:crypto";

export const backupDestinationPolicySchema =
  "romeo.backup-destination-policy.v1";

export function validateBackupDestinationPolicy(
  policy,
  {
    maximumAgeSeconds = 3600,
    minimumRetentionDays = 30,
    now = new Date(),
    requireReplication = true,
  } = {},
) {
  failUnless(
    policy?.schemaVersion === backupDestinationPolicySchema,
    "Backup destination policy schema is invalid.",
  );
  failUnless(
    nonEmpty(policy.destinationId),
    "Backup destinationId is missing.",
  );
  const observedAt = timestamp(policy.observedAt, "observedAt");
  const ageMs = now.getTime() - observedAt.getTime();
  failUnless(ageMs >= 0, "Backup destination evidence is from the future.");
  failUnless(
    ageMs <= maximumAgeSeconds * 1000,
    "Backup destination evidence is stale.",
  );
  failUnless(
    policy.versioningEnabled === true,
    "Backup versioning is disabled.",
  );
  if (requireReplication)
    failUnless(
      policy.replication?.enabled === true &&
        nonEmpty(policy.replication?.destination),
      "Backup replication is not verified.",
    );
  failUnless(
    ["COMPLIANCE", "GOVERNANCE"].includes(policy.objectLock?.mode),
    "Backup object lock mode is missing.",
  );
  failUnless(
    Number.isInteger(policy.objectLock?.minimumRetentionDays) &&
      policy.objectLock.minimumRetentionDays >= minimumRetentionDays,
    "Backup object lock retention is shorter than required.",
  );
  failUnless(
    policy.objectLock?.manifestsProtected === true &&
      policy.objectLock?.indexesProtected === true,
    "Backup manifests and indexes must be immutable.",
  );
  failUnless(
    policy.lifecycle?.earlyDeletionAllowed === false,
    "Backup lifecycle permits early deletion.",
  );
  failUnless(
    Number.isInteger(policy.lifecycle?.deleteAfterDays) &&
      policy.lifecycle.deleteAfterDays >=
        policy.objectLock.minimumRetentionDays,
    "Backup lifecycle deletion precedes the retention lock.",
  );
  failUnless(
    policy.legalHold?.supported === true &&
      policy.legalHold?.bypassRequiresProtectedApproval === true,
    "Backup legal-hold controls are incomplete.",
  );
  const canonical = canonicalJson(policy);
  return {
    schemaVersion: backupDestinationPolicySchema,
    verified: true,
    destinationIdHash: createHash("sha256")
      .update(policy.destinationId)
      .digest("hex"),
    observedAt: observedAt.toISOString(),
    verifiedAt: now.toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    versioningEnabled: true,
    replicationEnabled: policy.replication.enabled,
    objectLockMode: policy.objectLock.mode,
    minimumRetentionDays: policy.objectLock.minimumRetentionDays,
    manifestsProtected: true,
    indexesProtected: true,
    legalHoldSupported: true,
    policySha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function timestamp(value, label) {
  const date = new Date(value);
  failUnless(
    typeof value === "string" && !Number.isNaN(date.getTime()),
    `Backup destination ${label} is invalid.`,
  );
  return date;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function failUnless(condition, message) {
  if (!condition) throw new Error(message);
}
