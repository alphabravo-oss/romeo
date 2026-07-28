export type GaEvidenceChecklistStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "passed";

export type GaTargetPreflightStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "ready";

export type GaTargetEvidencePlanStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "ready";

export type GaTargetExecutionStatus =
  | "blocked"
  | "failed"
  | "invalid"
  | "not_configured"
  | "not_run"
  | "partial"
  | "passed";

export type GaEvidenceBundleStatus =
  | "blocked"
  | "invalid"
  | "not_configured"
  | "passed";

export type GaEvidencePostureStatus = "attention_required" | "passed";
