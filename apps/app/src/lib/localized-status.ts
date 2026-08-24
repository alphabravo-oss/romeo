import type { MessageKey } from "./i18n";

export const knownOperationalStatuses = [
  "active",
  "available",
  "cancelled",
  "completed",
  "disabled",
  "degraded",
  "enabled",
  "expired",
  "failed",
  "failure",
  "leased",
  "not_applicable",
  "passed",
  "pending",
  "queued",
  "ready",
  "revoked",
  "running",
  "scanning",
  "success",
  "skipped",
  "unavailable",
  "uploading",
  "verified",
] as const;
export type KnownOperationalStatus = (typeof knownOperationalStatuses)[number];

const statusMessageKeys = {
  active: "localizedStatusActive",
  available: "localizedStatusAvailable",
  cancelled: "localizedStatusCancelled",
  completed: "localizedStatusCompleted",
  disabled: "localizedStatusDisabled",
  degraded: "localizedStatusDegraded",
  enabled: "localizedStatusEnabled",
  expired: "localizedStatusExpired",
  failed: "localizedStatusFailed",
  failure: "localizedStatusFailure",
  leased: "localizedStatusLeased",
  not_applicable: "localizedStatusNotApplicable",
  passed: "localizedStatusPassed",
  pending: "localizedStatusPending",
  queued: "localizedStatusQueued",
  ready: "localizedStatusReady",
  revoked: "localizedStatusRevoked",
  running: "localizedStatusRunning",
  scanning: "localizedStatusScanning",
  success: "localizedStatusSuccess",
  skipped: "localizedStatusSkipped",
  unavailable: "localizedStatusUnavailable",
  uploading: "localizedStatusUploading",
  verified: "localizedStatusVerified",
} as const satisfies Record<KnownOperationalStatus, MessageKey>;

export function localizedStatus(
  value: string,
  translate: (key: MessageKey) => string,
): string {
  return translate(
    isKnownOperationalStatus(value)
      ? statusMessageKeys[value]
      : "localizedStatusUnknown",
  );
}

export function isKnownOperationalStatus(
  value: string,
): value is KnownOperationalStatus {
  return knownOperationalStatuses.some((status) => status === value);
}
