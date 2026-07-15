import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const provenanceRedactionFlags = [
  "tokenValuesReturned",
  "secretValuesReturned",
  "fileBodiesReturned",
  "rawSignatureReturned",
  "rawAttestationReturned",
  "rawCiRunUrlReturned",
  "rawSourceRepoReturned",
  "rawSourceRefReturned",
  "environmentReturned",
] as const;

const approvalRedactionFlags = [
  "rawApproverIdsReturned",
  "rawApprovalRefReturned",
  "secretValuesReturned",
  "fileBodiesReturned",
  "rawProvenanceReturned",
  "environmentReturned",
] as const;

const airgapRedactionFlags = [
  "artifactBodiesIncluded",
  "packageContentsIncluded",
  "sbomBodyIncluded",
  "provenanceBodyIncluded",
  "evidenceBodiesIncluded",
  "registryTokensIncluded",
  "secretValuesIncluded",
  "absoluteBundlePathsIncluded",
] as const;

type ReleaseSecurityInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

type ReleaseSecurityEvidenceSource = "configured_file" | "not_configured";

export type ReleaseSecurityPostureWarning =
  | "release_airgap_verification_blocked"
  | "release_airgap_verification_invalid"
  | "release_airgap_verification_not_configured"
  | "release_airgap_verification_redaction_missing"
  | "release_approval_blocked"
  | "release_approval_insufficient_approvers"
  | "release_approval_invalid"
  | "release_approval_not_configured"
  | "release_approval_redaction_missing"
  | "release_provenance_blocked"
  | "release_provenance_invalid"
  | "release_provenance_not_configured"
  | "release_provenance_redaction_missing"
  | "release_provenance_signature_missing"
  | "release_publish_plan_blocked"
  | "release_publish_plan_invalid"
  | "release_publish_plan_missing_approval"
  | "release_publish_plan_missing_provenance"
  | "release_publish_plan_not_configured"
  | "release_security_evidence_missing"
  | "release_security_version_mismatch";

export interface ReleaseSecurityPostureReport {
  schema: "romeo.release-security-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    provenancePassed: boolean;
    approvalPassed: boolean;
    publishPlanReady: boolean;
    airgapVerified: boolean;
    signedProvenanceAttached: boolean;
    approvalMinApproversSatisfied: boolean;
    releaseVersionConsistent: boolean;
    totalCheckCount: number;
    passedCheckCount: number;
    failedCheckCount: number;
    blockerCount: number;
  };
  provenance: ReleaseProvenancePosture;
  approval: ReleaseApprovalPosture;
  publishPlan: ReleasePublishPlanPosture;
  airgap: ReleaseAirgapPosture;
  redaction: {
    airgapBundlePathsReturned: false;
    approvalRefsReturned: false;
    approverIdsReturned: false;
    artifactBodiesReturned: false;
    attestationBodiesReturned: false;
    ciRunUrlsReturned: false;
    commandLinesReturned: false;
    environmentValuesReturned: false;
    evidenceFileBodiesReturned: false;
    gitRemotesReturned: false;
    rawEvidencePathsReturned: false;
    registryUrlsReturned: false;
    secretValuesReturned: false;
    signatureBodiesReturned: false;
    sourceRefsReturned: false;
    sourceReposReturned: false;
    tokenValuesReturned: false;
  };
  warnings: ReleaseSecurityPostureWarning[];
}

export interface ReleaseProvenancePosture {
  configured: boolean;
  source: ReleaseSecurityEvidenceSource;
  status: "blocked" | "invalid" | "not_configured" | "passed";
  schemaVersion?: "romeo.release-provenance.v1";
  generatedAt?: string;
  invalidReason?: ReleaseSecurityInvalidReason;
  release?: ReleaseSecurityReleaseSummary;
  sourcePosture: {
    commitShaConfigured: boolean;
    sourceRepoConfigured: boolean;
    sourceRefConfigured: boolean;
    builderIdConfigured: boolean;
    ciRunUrlConfigured: boolean;
  };
  supplyChain: {
    sbomAttached: boolean;
    securityEvidenceAttached: boolean;
    releaseChannelAttached: boolean;
    signatureAttached: boolean;
    attestationAttached: boolean;
    signatureRequired: boolean;
    attestationRequired: boolean;
    ciSourceRequired: boolean;
  };
  checks: ReleaseSecurityCheckSummary;
  blockers: ReleaseSecurityBlockerSummary;
  redactionSafe: boolean;
}

export interface ReleaseApprovalPosture {
  configured: boolean;
  source: ReleaseSecurityEvidenceSource;
  status: "blocked" | "invalid" | "not_configured" | "passed";
  schemaVersion?: "romeo.release-approval.v1";
  generatedAt?: string;
  invalidReason?: ReleaseSecurityInvalidReason;
  release?: ReleaseSecurityReleaseSummary;
  approval: {
    systemConfigured: boolean;
    refConfigured: boolean;
    approverCount: number;
    minApprovers: number;
    minApproversSatisfied: boolean;
    approvedAtConfigured: boolean;
    expiresAtConfigured: boolean;
    expiredAtGeneration: boolean;
  };
  checks: ReleaseSecurityCheckSummary;
  blockers: ReleaseSecurityBlockerSummary;
  redactionSafe: boolean;
}

export interface ReleasePublishPlanPosture {
  configured: boolean;
  source: ReleaseSecurityEvidenceSource;
  status: "blocked" | "invalid" | "not_configured" | "ready";
  schemaVersion?: "romeo.release-publish-plan.v1";
  generatedAt?: string;
  invalidReason?: ReleaseSecurityInvalidReason;
  release?: ReleaseSecurityReleaseSummary;
  artifacts: {
    total: number;
    packageArtifacts: number;
  };
  evidence: {
    securityEvidenceIncluded: boolean;
    provenanceIncluded: boolean;
    approvalIncluded: boolean;
    releaseNotesIncluded: boolean;
  };
  policy: {
    npmProvenance: boolean;
    requireApproval: boolean;
    requireSignedProvenance: boolean;
  };
  steps: {
    total: number;
    registryPublish: number;
    gitTag: number;
    gitPush: number;
    releaseAssetPublish: number;
  };
  blockers: ReleaseSecurityBlockerSummary;
}

export interface ReleaseAirgapPosture {
  configured: boolean;
  source: ReleaseSecurityEvidenceSource;
  status: "blocked" | "invalid" | "not_configured" | "passed";
  schemaVersion?: "romeo.airgap-bundle-verification.v1";
  generatedAt?: string;
  invalidReason?: ReleaseSecurityInvalidReason;
  release?: ReleaseSecurityReleaseSummary;
  requirements: {
    gaBundle: boolean;
    publishPlan: boolean;
    releaseReadback: boolean;
    readbackValidation: boolean;
    signedProvenance: boolean;
    approval: boolean;
  };
  bundle: {
    artifactCount: number;
    evidenceFileCount: number;
    totalBytes: number;
    inventoryHashPresent: boolean;
  };
  files: {
    manifest: boolean;
    channel: boolean;
    securityEvidence: boolean;
    sbom: boolean;
    provenance: boolean;
    approval: boolean;
    gaBundle: boolean;
    publishPlan: boolean;
    releaseReadback: boolean;
    readbackValidation: boolean;
  };
  checks: ReleaseSecurityCheckSummary;
  blockers: ReleaseSecurityBlockerSummary;
  redactionSafe: boolean;
}

export interface ReleaseSecurityReleaseSummary {
  name?: string;
  version?: string;
}

export interface ReleaseSecurityCheckSummary {
  total: number;
  passed: number;
  failed: number;
  planned: number;
  unknown: number;
}

export interface ReleaseSecurityBlockerSummary {
  total: number;
  codes: string[];
}

export class ReleaseSecurityPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<ReleaseSecurityPostureReport> {
    assertScope(subject, "admin:read");

    const provenance = await summarizeProvenance(
      this.env.RELEASE_PROVENANCE_EVIDENCE_PATH,
    );
    const approval = await summarizeApproval(
      this.env.RELEASE_APPROVAL_EVIDENCE_PATH,
    );
    const publishPlan = await summarizePublishPlan(
      this.env.RELEASE_PUBLISH_PLAN_PATH,
    );
    const airgap = await summarizeAirgap(
      this.env.RELEASE_AIRGAP_VERIFICATION_PATH,
    );
    const versionConsistent = releaseVersionsConsistent([
      provenance.release,
      approval.release,
      publishPlan.release,
      airgap.release,
    ]);
    const warnings = releaseSecurityWarnings({
      airgap,
      approval,
      provenance,
      publishPlan,
      versionConsistent,
    });

    return {
      schema: "romeo.release-security-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      summary: {
        provenancePassed: provenance.status === "passed",
        approvalPassed: approval.status === "passed",
        publishPlanReady: publishPlan.status === "ready",
        airgapVerified: airgap.status === "passed",
        signedProvenanceAttached:
          provenance.supplyChain.signatureAttached ||
          provenance.supplyChain.attestationAttached,
        approvalMinApproversSatisfied: approval.approval.minApproversSatisfied,
        releaseVersionConsistent: versionConsistent,
        totalCheckCount:
          provenance.checks.total + approval.checks.total + airgap.checks.total,
        passedCheckCount:
          provenance.checks.passed +
          approval.checks.passed +
          airgap.checks.passed,
        failedCheckCount:
          provenance.checks.failed +
          approval.checks.failed +
          airgap.checks.failed,
        blockerCount:
          provenance.blockers.total +
          approval.blockers.total +
          publishPlan.blockers.total +
          airgap.blockers.total,
      },
      provenance,
      approval,
      publishPlan,
      airgap,
      redaction: releaseSecurityRedaction(),
      warnings,
    };
  }
}

async function summarizeProvenance(
  evidencePath: string,
): Promise<ReleaseProvenancePosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyProvenance("not_configured", [], true);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyProvenance(
      "invalid",
      [result.invalidReason],
      false,
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.release-provenance.v1") {
    return emptyProvenance(
      "invalid",
      ["schema_mismatch"],
      false,
      "schema_mismatch",
    );
  }

  const checks = checkSummary(data.checks);
  const blockers = blockerSummary(data.blockers);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    provenanceRedactionFlags,
  );
  const status =
    data.status === "passed" && blockers.total === 0 && redactionSafe
      ? "passed"
      : "blocked";
  const generatedAt = stringValue(data.generatedAt);
  const source = recordValue(data.source);
  const supplyChain = recordValue(data.supplyChain);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.release-provenance.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    release: releaseSummary(data.release),
    sourcePosture: {
      commitShaConfigured: source.commitShaConfigured === true,
      sourceRepoConfigured: source.sourceRepoConfigured === true,
      sourceRefConfigured: source.sourceRefConfigured === true,
      builderIdConfigured: source.builderIdConfigured === true,
      ciRunUrlConfigured: source.ciRunUrlConfigured === true,
    },
    supplyChain: {
      sbomAttached: supplyChain.sbomAttached === true,
      securityEvidenceAttached: supplyChain.securityEvidenceAttached === true,
      releaseChannelAttached: supplyChain.releaseChannelAttached === true,
      signatureAttached: supplyChain.signatureAttached === true,
      attestationAttached: supplyChain.attestationAttached === true,
      signatureRequired: supplyChain.signatureRequired === true,
      attestationRequired: supplyChain.attestationRequired === true,
      ciSourceRequired: supplyChain.ciSourceRequired === true,
    },
    checks,
    blockers,
    redactionSafe,
  };
}

function emptyProvenance(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  redactionSafe: boolean,
  invalidReason?: ReleaseSecurityInvalidReason,
): ReleaseProvenancePosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    sourcePosture: {
      commitShaConfigured: false,
      sourceRepoConfigured: false,
      sourceRefConfigured: false,
      builderIdConfigured: false,
      ciRunUrlConfigured: false,
    },
    supplyChain: {
      sbomAttached: false,
      securityEvidenceAttached: false,
      releaseChannelAttached: false,
      signatureAttached: false,
      attestationAttached: false,
      signatureRequired: false,
      attestationRequired: false,
      ciSourceRequired: false,
    },
    checks: emptyCheckSummary(),
    blockers: { total: failureCodes.length, codes: failureCodes },
    redactionSafe,
  };
}

async function summarizeApproval(
  evidencePath: string,
): Promise<ReleaseApprovalPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyApproval("not_configured", [], true);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyApproval(
      "invalid",
      [result.invalidReason],
      false,
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.release-approval.v1") {
    return emptyApproval(
      "invalid",
      ["schema_mismatch"],
      false,
      "schema_mismatch",
    );
  }

  const checks = checkSummary(data.checks);
  const blockers = blockerSummary(data.blockers);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    approvalRedactionFlags,
  );
  const status =
    data.status === "passed" && blockers.total === 0 && redactionSafe
      ? "passed"
      : "blocked";
  const generatedAt = stringValue(data.generatedAt);
  const approval = recordValue(data.approval);
  const approverCount = numberValue(approval.approverCount) ?? 0;
  const minApprovers = numberValue(approval.minApprovers) ?? 0;
  const expiresAt = stringValue(approval.expiresAt);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.release-approval.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    release: releaseSummary(data.release),
    approval: {
      systemConfigured: stringValue(approval.system) !== undefined,
      refConfigured: approval.refConfigured === true,
      approverCount,
      minApprovers,
      minApproversSatisfied:
        approverCount >=
        Math.max(Number.isInteger(minApprovers) ? minApprovers : 0, 2),
      approvedAtConfigured: stringValue(approval.approvedAt) !== undefined,
      expiresAtConfigured: expiresAt !== undefined,
      expiredAtGeneration:
        expiresAt !== undefined &&
        generatedAt !== undefined &&
        Date.parse(expiresAt) <= Date.parse(generatedAt),
    },
    checks,
    blockers,
    redactionSafe,
  };
}

function emptyApproval(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  redactionSafe: boolean,
  invalidReason?: ReleaseSecurityInvalidReason,
): ReleaseApprovalPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    approval: {
      systemConfigured: false,
      refConfigured: false,
      approverCount: 0,
      minApprovers: 0,
      minApproversSatisfied: false,
      approvedAtConfigured: false,
      expiresAtConfigured: false,
      expiredAtGeneration: false,
    },
    checks: emptyCheckSummary(),
    blockers: { total: failureCodes.length, codes: failureCodes },
    redactionSafe,
  };
}

async function summarizePublishPlan(
  evidencePath: string,
): Promise<ReleasePublishPlanPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyPublishPlan("not_configured", []);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyPublishPlan(
      "invalid",
      [result.invalidReason],
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.release-publish-plan.v1") {
    return emptyPublishPlan("invalid", ["schema_mismatch"], "schema_mismatch");
  }

  const blockers = blockerSummary(data.blockers);
  const status =
    data.status === "ready" && blockers.total === 0 ? "ready" : "blocked";
  const generatedAt = stringValue(data.generatedAt);
  const release = recordValue(data.release);
  const policy = recordValue(data.policy);
  const artifacts = recordArray(release.artifacts);
  const steps = recordArray(data.steps);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.release-publish-plan.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    release: releaseSummary(release),
    artifacts: {
      total: artifacts.length,
      packageArtifacts: artifacts.filter(
        (artifact) => stringValue(artifact.name) !== undefined,
      ).length,
    },
    evidence: {
      securityEvidenceIncluded: isRecord(release.securityEvidence),
      provenanceIncluded: isRecord(release.provenance),
      approvalIncluded: isRecord(release.approval),
      releaseNotesIncluded: isRecord(release.releaseNotes),
    },
    policy: {
      npmProvenance: policy.npmProvenance === true,
      requireApproval: policy.requireApproval === true,
      requireSignedProvenance: policy.requireSignedProvenance === true,
    },
    steps: {
      total: steps.length,
      registryPublish: stepKindCount(steps, "registry_publish"),
      gitTag: stepKindCount(steps, "git_tag"),
      gitPush: stepKindCount(steps, "git_push"),
      releaseAssetPublish: stepKindCount(steps, "release_notes"),
    },
    blockers,
  };
}

function emptyPublishPlan(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  invalidReason?: ReleaseSecurityInvalidReason,
): ReleasePublishPlanPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    artifacts: { total: 0, packageArtifacts: 0 },
    evidence: {
      securityEvidenceIncluded: false,
      provenanceIncluded: false,
      approvalIncluded: false,
      releaseNotesIncluded: false,
    },
    policy: {
      npmProvenance: false,
      requireApproval: false,
      requireSignedProvenance: false,
    },
    steps: {
      total: 0,
      registryPublish: 0,
      gitTag: 0,
      gitPush: 0,
      releaseAssetPublish: 0,
    },
    blockers: { total: failureCodes.length, codes: failureCodes },
  };
}

async function summarizeAirgap(
  evidencePath: string,
): Promise<ReleaseAirgapPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyAirgap("not_configured", [], true);
  }

  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyAirgap(
      "invalid",
      [result.invalidReason],
      false,
      result.invalidReason,
    );
  }

  const data = result.data;
  if (data.schemaVersion !== "romeo.airgap-bundle-verification.v1") {
    return emptyAirgap(
      "invalid",
      ["schema_mismatch"],
      false,
      "schema_mismatch",
    );
  }

  const checks = checkSummary(data.checks);
  const blockers = blockerSummary(data.blockers);
  const redactionSafe = allRedactionFlagsFalse(
    data.redaction,
    airgapRedactionFlags,
  );
  const status =
    data.status === "passed" && blockers.total === 0 && redactionSafe
      ? "passed"
      : "blocked";
  const generatedAt = stringValue(data.generatedAt);
  const bundle = recordValue(data.bundle);
  const requirements = recordValue(data.requirements);
  const files = recordValue(data.files);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.airgap-bundle-verification.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    release: {
      ...optionalStringProperty("name", bundle.releaseName),
      ...optionalStringProperty("version", bundle.releaseVersion),
    },
    requirements: {
      gaBundle: requirements.gaBundle === true,
      publishPlan: requirements.publishPlan === true,
      releaseReadback: requirements.releaseReadback === true,
      readbackValidation: requirements.readbackValidation === true,
      signedProvenance: requirements.signedProvenance === true,
      approval: requirements.approval === true,
    },
    bundle: {
      artifactCount: numberValue(bundle.artifactCount) ?? 0,
      evidenceFileCount: numberValue(bundle.evidenceFileCount) ?? 0,
      totalBytes: numberValue(bundle.totalBytes) ?? 0,
      inventoryHashPresent: stringValue(bundle.sha256) !== undefined,
    },
    files: {
      manifest: airgapFilePresent(files.manifest),
      channel: airgapFilePresent(files.channel),
      securityEvidence: airgapFilePresent(files.securityEvidence),
      sbom: airgapFilePresent(files.sbom),
      provenance: airgapFilePresent(files.provenance),
      approval: airgapFilePresent(files.approval),
      gaBundle: airgapFilePresent(files.gaBundle),
      publishPlan: airgapFilePresent(files.publishPlan),
      releaseReadback: airgapFilePresent(files.releaseReadback),
      readbackValidation: airgapFilePresent(files.readbackValidation),
    },
    checks,
    blockers,
    redactionSafe,
  };
}

function emptyAirgap(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  redactionSafe: boolean,
  invalidReason?: ReleaseSecurityInvalidReason,
): ReleaseAirgapPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    requirements: {
      gaBundle: false,
      publishPlan: false,
      releaseReadback: false,
      readbackValidation: false,
      signedProvenance: false,
      approval: false,
    },
    bundle: {
      artifactCount: 0,
      evidenceFileCount: 0,
      totalBytes: 0,
      inventoryHashPresent: false,
    },
    files: {
      manifest: false,
      channel: false,
      securityEvidence: false,
      sbom: false,
      provenance: false,
      approval: false,
      gaBundle: false,
      publishPlan: false,
      releaseReadback: false,
      readbackValidation: false,
    },
    checks: emptyCheckSummary(),
    blockers: { total: failureCodes.length, codes: failureCodes },
    redactionSafe,
  };
}

function releaseSecurityWarnings(input: {
  provenance: ReleaseProvenancePosture;
  approval: ReleaseApprovalPosture;
  publishPlan: ReleasePublishPlanPosture;
  airgap: ReleaseAirgapPosture;
  versionConsistent: boolean;
}): ReleaseSecurityPostureWarning[] {
  const warnings: ReleaseSecurityPostureWarning[] = [];
  if (
    !input.provenance.configured &&
    !input.approval.configured &&
    !input.publishPlan.configured &&
    !input.airgap.configured
  ) {
    warnings.push("release_security_evidence_missing");
  }

  pushEvidenceWarning(warnings, input.provenance.status, {
    blocked: "release_provenance_blocked",
    invalid: "release_provenance_invalid",
    notConfigured: "release_provenance_not_configured",
  });
  if (!input.provenance.redactionSafe) {
    warnings.push("release_provenance_redaction_missing");
  }
  if (
    input.provenance.configured &&
    !input.provenance.supplyChain.signatureAttached &&
    !input.provenance.supplyChain.attestationAttached
  ) {
    warnings.push("release_provenance_signature_missing");
  }

  pushEvidenceWarning(warnings, input.approval.status, {
    blocked: "release_approval_blocked",
    invalid: "release_approval_invalid",
    notConfigured: "release_approval_not_configured",
  });
  if (!input.approval.redactionSafe) {
    warnings.push("release_approval_redaction_missing");
  }
  if (
    input.approval.configured &&
    !input.approval.approval.minApproversSatisfied
  ) {
    warnings.push("release_approval_insufficient_approvers");
  }

  pushEvidenceWarning(warnings, input.publishPlan.status, {
    blocked: "release_publish_plan_blocked",
    invalid: "release_publish_plan_invalid",
    notConfigured: "release_publish_plan_not_configured",
  });
  if (
    input.publishPlan.configured &&
    !input.publishPlan.evidence.provenanceIncluded
  ) {
    warnings.push("release_publish_plan_missing_provenance");
  }
  if (
    input.publishPlan.configured &&
    input.publishPlan.policy.requireApproval &&
    !input.publishPlan.evidence.approvalIncluded
  ) {
    warnings.push("release_publish_plan_missing_approval");
  }

  pushEvidenceWarning(warnings, input.airgap.status, {
    blocked: "release_airgap_verification_blocked",
    invalid: "release_airgap_verification_invalid",
    notConfigured: "release_airgap_verification_not_configured",
  });
  if (!input.airgap.redactionSafe) {
    warnings.push("release_airgap_verification_redaction_missing");
  }
  if (!input.versionConsistent) {
    warnings.push("release_security_version_mismatch");
  }

  return [...new Set(warnings)];
}

function pushEvidenceWarning(
  warnings: ReleaseSecurityPostureWarning[],
  status:
    | ReleaseProvenancePosture["status"]
    | ReleaseApprovalPosture["status"]
    | ReleasePublishPlanPosture["status"]
    | ReleaseAirgapPosture["status"],
  codes: {
    blocked: ReleaseSecurityPostureWarning;
    invalid: ReleaseSecurityPostureWarning;
    notConfigured: ReleaseSecurityPostureWarning;
  },
): void {
  if (status === "not_configured") warnings.push(codes.notConfigured);
  else if (status === "invalid") warnings.push(codes.invalid);
  else if (status === "blocked") warnings.push(codes.blocked);
}

function releaseSecurityRedaction(): ReleaseSecurityPostureReport["redaction"] {
  return {
    airgapBundlePathsReturned: false,
    approvalRefsReturned: false,
    approverIdsReturned: false,
    artifactBodiesReturned: false,
    attestationBodiesReturned: false,
    ciRunUrlsReturned: false,
    commandLinesReturned: false,
    environmentValuesReturned: false,
    evidenceFileBodiesReturned: false,
    gitRemotesReturned: false,
    rawEvidencePathsReturned: false,
    registryUrlsReturned: false,
    secretValuesReturned: false,
    signatureBodiesReturned: false,
    sourceRefsReturned: false,
    sourceReposReturned: false,
    tokenValuesReturned: false,
  };
}

type ReadJsonResult =
  | { status: "valid"; data: Record<string, unknown> }
  | { status: "invalid"; invalidReason: ReleaseSecurityInvalidReason };

async function readJson(path: string): Promise<ReadJsonResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { status: "invalid", invalidReason: "read_failed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", invalidReason: "invalid_json" };
  }

  if (!isRecord(parsed)) {
    return { status: "invalid", invalidReason: "schema_mismatch" };
  }
  return { status: "valid", data: parsed };
}

function checkSummary(value: unknown): ReleaseSecurityCheckSummary {
  return recordArray(value).reduce<ReleaseSecurityCheckSummary>(
    (summary, check) => {
      summary.total += 1;
      const status = stringValue(check.status);
      if (status === "pass" || status === "passed") summary.passed += 1;
      else if (status === "fail" || status === "failed") summary.failed += 1;
      else if (status === "planned") summary.planned += 1;
      else summary.unknown += 1;
      return summary;
    },
    emptyCheckSummary(),
  );
}

function emptyCheckSummary(): ReleaseSecurityCheckSummary {
  return { total: 0, passed: 0, failed: 0, planned: 0, unknown: 0 };
}

function blockerSummary(value: unknown): ReleaseSecurityBlockerSummary {
  const codes = recordArray(value)
    .map((blocker) => stringValue(blocker.code))
    .filter((code): code is string => code !== undefined && code.length > 0);
  return { total: codes.length, codes };
}

function releaseSummary(value: unknown): ReleaseSecurityReleaseSummary {
  const release = recordValue(value);
  return {
    ...optionalStringProperty("name", release.name),
    ...optionalStringProperty("version", release.version),
  };
}

function releaseVersionsConsistent(
  releases: Array<ReleaseSecurityReleaseSummary | undefined>,
): boolean {
  const versions = releases
    .map((release) => release?.version)
    .filter((version): version is string => version !== undefined);
  return new Set(versions).size <= 1;
}

function allRedactionFlagsFalse(
  value: unknown,
  flags: readonly string[],
): boolean {
  const redaction = recordValue(value);
  return flags.every((flag) => redaction[flag] === false);
}

function airgapFilePresent(value: unknown): boolean {
  return recordValue(value).present === true;
}

function stepKindCount(steps: Record<string, unknown>[], kind: string): number {
  return steps.filter((step) => step.kind === kind).length;
}

function optionalStringProperty<K extends string>(
  key: K,
  value: unknown,
): { [P in K]?: string } {
  if (typeof value !== "string" || value.length === 0) return {};
  const result: Partial<Record<K, string>> = {};
  result[key] = value;
  return result;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
