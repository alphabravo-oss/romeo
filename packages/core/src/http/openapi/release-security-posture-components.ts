const configuredSourceSchema = {
  type: "string",
  enum: ["configured_file", "not_configured"],
};

const invalidReasonSchema = {
  type: "string",
  enum: ["invalid_json", "read_failed", "schema_mismatch"],
};

const passiveEvidenceStatusSchema = {
  type: "string",
  enum: ["blocked", "invalid", "not_configured", "passed"],
};

const publishPlanStatusSchema = {
  type: "string",
  enum: ["blocked", "invalid", "not_configured", "ready"],
};

const releaseSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    version: { type: "string" },
  },
};

const checkSummarySchema = {
  type: "object",
  required: ["total", "passed", "failed", "planned", "unknown"],
  additionalProperties: false,
  properties: {
    total: { type: "integer", minimum: 0 },
    passed: { type: "integer", minimum: 0 },
    failed: { type: "integer", minimum: 0 },
    planned: { type: "integer", minimum: 0 },
    unknown: { type: "integer", minimum: 0 },
  },
};

const blockerSummarySchema = {
  type: "object",
  required: ["total", "codes"],
  additionalProperties: false,
  properties: {
    total: { type: "integer", minimum: 0 },
    codes: { type: "array", items: { type: "string" } },
  },
};

const booleanFalseSchema = { type: "boolean", enum: [false] };

export const releaseSecurityPostureSchemas = {
  ReleaseSecurityPostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "summary",
      "provenance",
      "approval",
      "publishPlan",
      "airgap",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: {
        type: "string",
        enum: ["romeo.release-security-posture.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      summary: {
        type: "object",
        required: [
          "provenancePassed",
          "approvalPassed",
          "publishPlanReady",
          "airgapVerified",
          "signedProvenanceAttached",
          "approvalMinApproversSatisfied",
          "releaseVersionConsistent",
          "totalCheckCount",
          "passedCheckCount",
          "failedCheckCount",
          "blockerCount",
        ],
        additionalProperties: false,
        properties: {
          provenancePassed: { type: "boolean" },
          approvalPassed: { type: "boolean" },
          publishPlanReady: { type: "boolean" },
          airgapVerified: { type: "boolean" },
          signedProvenanceAttached: { type: "boolean" },
          approvalMinApproversSatisfied: { type: "boolean" },
          releaseVersionConsistent: { type: "boolean" },
          totalCheckCount: { type: "integer", minimum: 0 },
          passedCheckCount: { type: "integer", minimum: 0 },
          failedCheckCount: { type: "integer", minimum: 0 },
          blockerCount: { type: "integer", minimum: 0 },
        },
      },
      provenance: provenancePostureSchema(),
      approval: approvalPostureSchema(),
      publishPlan: publishPlanPostureSchema(),
      airgap: airgapPostureSchema(),
      redaction: redactionSchema(),
      warnings: { type: "array", items: { type: "string" } },
    },
  },
};

function provenancePostureSchema() {
  return {
    type: "object",
    required: [
      "configured",
      "source",
      "status",
      "sourcePosture",
      "supplyChain",
      "checks",
      "blockers",
      "redactionSafe",
    ],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: configuredSourceSchema,
      status: passiveEvidenceStatusSchema,
      schemaVersion: {
        type: "string",
        enum: ["romeo.release-provenance.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      invalidReason: invalidReasonSchema,
      release: releaseSummarySchema,
      sourcePosture: {
        type: "object",
        required: [
          "commitShaConfigured",
          "sourceRepoConfigured",
          "sourceRefConfigured",
          "builderIdConfigured",
          "ciRunUrlConfigured",
        ],
        additionalProperties: false,
        properties: {
          commitShaConfigured: { type: "boolean" },
          sourceRepoConfigured: { type: "boolean" },
          sourceRefConfigured: { type: "boolean" },
          builderIdConfigured: { type: "boolean" },
          ciRunUrlConfigured: { type: "boolean" },
        },
      },
      supplyChain: {
        type: "object",
        required: [
          "sbomAttached",
          "securityEvidenceAttached",
          "releaseChannelAttached",
          "signatureAttached",
          "attestationAttached",
          "signatureRequired",
          "attestationRequired",
          "ciSourceRequired",
        ],
        additionalProperties: false,
        properties: {
          sbomAttached: { type: "boolean" },
          securityEvidenceAttached: { type: "boolean" },
          releaseChannelAttached: { type: "boolean" },
          signatureAttached: { type: "boolean" },
          attestationAttached: { type: "boolean" },
          signatureRequired: { type: "boolean" },
          attestationRequired: { type: "boolean" },
          ciSourceRequired: { type: "boolean" },
        },
      },
      checks: checkSummarySchema,
      blockers: blockerSummarySchema,
      redactionSafe: { type: "boolean" },
    },
  };
}

function approvalPostureSchema() {
  return {
    type: "object",
    required: [
      "configured",
      "source",
      "status",
      "approval",
      "checks",
      "blockers",
      "redactionSafe",
    ],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: configuredSourceSchema,
      status: passiveEvidenceStatusSchema,
      schemaVersion: { type: "string", enum: ["romeo.release-approval.v1"] },
      generatedAt: { type: "string", format: "date-time" },
      invalidReason: invalidReasonSchema,
      release: releaseSummarySchema,
      approval: {
        type: "object",
        required: [
          "systemConfigured",
          "refConfigured",
          "approverCount",
          "minApprovers",
          "minApproversSatisfied",
          "approvedAtConfigured",
          "expiresAtConfigured",
          "expiredAtGeneration",
        ],
        additionalProperties: false,
        properties: {
          systemConfigured: { type: "boolean" },
          refConfigured: { type: "boolean" },
          approverCount: { type: "integer", minimum: 0 },
          minApprovers: { type: "integer", minimum: 0 },
          minApproversSatisfied: { type: "boolean" },
          approvedAtConfigured: { type: "boolean" },
          expiresAtConfigured: { type: "boolean" },
          expiredAtGeneration: { type: "boolean" },
        },
      },
      checks: checkSummarySchema,
      blockers: blockerSummarySchema,
      redactionSafe: { type: "boolean" },
    },
  };
}

function publishPlanPostureSchema() {
  return {
    type: "object",
    required: [
      "configured",
      "source",
      "status",
      "artifacts",
      "evidence",
      "policy",
      "steps",
      "blockers",
    ],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: configuredSourceSchema,
      status: publishPlanStatusSchema,
      schemaVersion: {
        type: "string",
        enum: ["romeo.release-publish-plan.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      invalidReason: invalidReasonSchema,
      release: releaseSummarySchema,
      artifacts: countPairSchema("total", "packageArtifacts"),
      evidence: {
        type: "object",
        required: [
          "securityEvidenceIncluded",
          "provenanceIncluded",
          "approvalIncluded",
          "releaseNotesIncluded",
        ],
        additionalProperties: false,
        properties: {
          securityEvidenceIncluded: { type: "boolean" },
          provenanceIncluded: { type: "boolean" },
          approvalIncluded: { type: "boolean" },
          releaseNotesIncluded: { type: "boolean" },
        },
      },
      policy: {
        type: "object",
        required: [
          "npmProvenance",
          "requireApproval",
          "requireSignedProvenance",
        ],
        additionalProperties: false,
        properties: {
          npmProvenance: { type: "boolean" },
          requireApproval: { type: "boolean" },
          requireSignedProvenance: { type: "boolean" },
        },
      },
      steps: {
        type: "object",
        required: [
          "total",
          "registryPublish",
          "gitTag",
          "gitPush",
          "releaseAssetPublish",
        ],
        additionalProperties: false,
        properties: {
          total: { type: "integer", minimum: 0 },
          registryPublish: { type: "integer", minimum: 0 },
          gitTag: { type: "integer", minimum: 0 },
          gitPush: { type: "integer", minimum: 0 },
          releaseAssetPublish: { type: "integer", minimum: 0 },
        },
      },
      blockers: blockerSummarySchema,
    },
  };
}

function airgapPostureSchema() {
  return {
    type: "object",
    required: [
      "configured",
      "source",
      "status",
      "requirements",
      "bundle",
      "files",
      "checks",
      "blockers",
      "redactionSafe",
    ],
    additionalProperties: false,
    properties: {
      configured: { type: "boolean" },
      source: configuredSourceSchema,
      status: passiveEvidenceStatusSchema,
      schemaVersion: {
        type: "string",
        enum: ["romeo.airgap-bundle-verification.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      invalidReason: invalidReasonSchema,
      release: releaseSummarySchema,
      requirements: boolMapSchema([
        "gaBundle",
        "publishPlan",
        "releaseReadback",
        "readbackValidation",
        "signedProvenance",
        "approval",
      ]),
      bundle: {
        type: "object",
        required: [
          "artifactCount",
          "evidenceFileCount",
          "totalBytes",
          "inventoryHashPresent",
        ],
        additionalProperties: false,
        properties: {
          artifactCount: { type: "integer", minimum: 0 },
          evidenceFileCount: { type: "integer", minimum: 0 },
          totalBytes: { type: "integer", minimum: 0 },
          inventoryHashPresent: { type: "boolean" },
        },
      },
      files: boolMapSchema([
        "manifest",
        "channel",
        "securityEvidence",
        "sbom",
        "provenance",
        "approval",
        "gaBundle",
        "publishPlan",
        "releaseReadback",
        "readbackValidation",
      ]),
      checks: checkSummarySchema,
      blockers: blockerSummarySchema,
      redactionSafe: { type: "boolean" },
    },
  };
}

function countPairSchema(first: string, second: string) {
  return {
    type: "object",
    required: [first, second],
    additionalProperties: false,
    properties: {
      [first]: { type: "integer", minimum: 0 },
      [second]: { type: "integer", minimum: 0 },
    },
  };
}

function boolMapSchema(keys: string[]) {
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: "boolean" }]),
    ),
  };
}

function redactionSchema() {
  const keys = [
    "airgapBundlePathsReturned",
    "approvalRefsReturned",
    "approverIdsReturned",
    "artifactBodiesReturned",
    "attestationBodiesReturned",
    "ciRunUrlsReturned",
    "commandLinesReturned",
    "environmentValuesReturned",
    "evidenceFileBodiesReturned",
    "gitRemotesReturned",
    "rawEvidencePathsReturned",
    "registryUrlsReturned",
    "secretValuesReturned",
    "signatureBodiesReturned",
    "sourceRefsReturned",
    "sourceReposReturned",
    "tokenValuesReturned",
  ];
  return {
    type: "object",
    required: keys,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => [key, booleanFalseSchema]),
    ),
  };
}
