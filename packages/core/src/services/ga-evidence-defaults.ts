import type { GaEvidencePostureReport } from "./ga-evidence-types";

export const emptySummary = {
  total: 0,
  satisfied: 0,
  excepted: 0,
  blocked: 0,
  environmentRequired: 0,
  securityCriticalBlocked: 0,
};

export const emptyPreflightSummary = {
  total: 0,
  ready: 0,
  blocked: 0,
  securityCriticalBlocked: 0,
};

export const emptyTargetPlanSummary = {
  total: 0,
  ready: 0,
  blocked: 0,
  environmentRequired: 0,
  securityCriticalBlocked: 0,
  phaseCount: 0,
  commandCount: 0,
  evidenceTargetCount: 0,
  blockedCheckCount: 0,
};

export const emptyTargetExecutionSummary = {
  total: 0,
  readyToRun: 0,
  executed: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  confirmationRequired: 0,
  blocked: 0,
  redacted: 0,
  commandMissing: 0,
};

export const emptyTargetExecutionRun = {
  confirmed: false,
  continueOnFailure: false,
  timeoutMs: 0,
  selectedGateCount: 0,
  commandsExecuted: 0,
};

export const emptyTargetExecutionEnvFile = {
  configured: false,
  loaded: false,
  variableCount: 0,
  populatedVariableCount: 0,
  blankVariableCount: 0,
  duplicateCount: 0,
  appliedVariableCount: 0,
  variableNames: [],
  warningCodes: [],
  rawValuesReturned: false,
  rawFileBodyReturned: false,
  shellSourced: false,
  blankValuesApplied: false,
} satisfies GaEvidencePostureReport["targetExecution"]["envFile"];

export const emptyBundleRequirements = {
  checklistPassed: false,
  readbackValidation: false,
  supportBundle: false,
  supportRedaction: false,
  docsCommandCheck: false,
  tenantIsolation: false,
};

export const emptyBundleInventory = {
  evidenceFileCount: 0,
  totalBytes: 0,
};

export const emptyBundleCheckSummary = {
  total: 0,
  passed: 0,
  failed: 0,
};
