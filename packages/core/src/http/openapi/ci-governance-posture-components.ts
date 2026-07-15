const configuredSourceSchema = {
  type: "string",
  enum: ["configured_file", "not_configured"],
};

const invalidReasonSchema = {
  type: "string",
  enum: ["invalid_json", "read_failed", "schema_mismatch"],
};

const liveEvidenceStatusSchema = {
  type: "string",
  enum: ["blocked", "invalid", "not_configured", "passed", "planned"],
};

const planEvidenceStatusSchema = {
  type: "string",
  enum: ["blocked", "invalid", "not_configured", "passed"],
};

const embeddedEvidenceStatusSchema = {
  type: "string",
  enum: ["blocked", "passed", "planned", "unknown"],
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

const policySummarySchema = {
  type: "object",
  required: [
    "requirePullRequest",
    "requireConversationResolution",
    "requireLinearHistory",
    "requireSignedCommits",
    "requireUpToDateBeforeMerge",
    "dismissStaleApprovals",
    "restrictBypassToReleaseAdmins",
    "requireCodeOwnerReviews",
  ],
  additionalProperties: false,
  properties: {
    requirePullRequest: { type: "boolean" },
    requireConversationResolution: { type: "boolean" },
    requireLinearHistory: { type: "boolean" },
    requireSignedCommits: { type: "boolean" },
    requireUpToDateBeforeMerge: { type: "boolean" },
    dismissStaleApprovals: { type: "boolean" },
    restrictBypassToReleaseAdmins: { type: "boolean" },
    requireCodeOwnerReviews: { type: "boolean" },
    requiredApprovingReviewCount: { type: "integer", minimum: 0 },
  },
};

export const ciGovernancePostureSchemas = {
  CiGovernancePostureReport: {
    type: "object",
    required: [
      "schema",
      "generatedAt",
      "orgId",
      "status",
      "summary",
      "plan",
      "hostedRun",
      "branchProtection",
      "redaction",
      "warnings",
    ],
    additionalProperties: false,
    properties: {
      schema: {
        type: "string",
        enum: ["romeo.ci-governance-posture.v1"],
      },
      generatedAt: { type: "string", format: "date-time" },
      orgId: { type: "string" },
      status: { type: "string", enum: ["attention_required", "ready"] },
      summary: {
        type: "object",
        required: [
          "planReady",
          "hostedRunVerified",
          "branchProtectionVerified",
          "requiredStatusCheckCount",
          "requiredWorkflowCommandCount",
          "totalCheckCount",
          "passedCheckCount",
          "failedCheckCount",
          "plannedCheckCount",
          "blockerCount",
        ],
        additionalProperties: false,
        properties: {
          planReady: { type: "boolean" },
          hostedRunVerified: { type: "boolean" },
          branchProtectionVerified: { type: "boolean" },
          requiredStatusCheckCount: { type: "integer", minimum: 0 },
          requiredWorkflowCommandCount: { type: "integer", minimum: 0 },
          totalCheckCount: { type: "integer", minimum: 0 },
          passedCheckCount: { type: "integer", minimum: 0 },
          failedCheckCount: { type: "integer", minimum: 0 },
          plannedCheckCount: { type: "integer", minimum: 0 },
          blockerCount: { type: "integer", minimum: 0 },
        },
      },
      plan: {
        type: "object",
        required: [
          "configured",
          "source",
          "status",
          "workflow",
          "policy",
          "requiredStatusCheckCount",
          "requiredWorkflowCommandCount",
          "checks",
          "blockers",
          "redactionSafe",
        ],
        additionalProperties: false,
        properties: {
          configured: { type: "boolean" },
          source: configuredSourceSchema,
          status: planEvidenceStatusSchema,
          schemaVersion: {
            type: "string",
            enum: ["romeo.branch-protection-plan.v1"],
          },
          generatedAt: { type: "string", format: "date-time" },
          invalidReason: invalidReasonSchema,
          provider: { type: "string", enum: ["github", "unknown"] },
          workflow: {
            type: "object",
            required: ["configured", "jobCount"],
            additionalProperties: false,
            properties: {
              configured: { type: "boolean" },
              jobCount: { type: "integer", minimum: 0 },
            },
          },
          policy: policySummarySchema,
          requiredStatusCheckCount: { type: "integer", minimum: 0 },
          requiredWorkflowCommandCount: { type: "integer", minimum: 0 },
          checks: checkSummarySchema,
          blockers: blockerSummarySchema,
          redactionSafe: { type: "boolean" },
        },
      },
      hostedRun: {
        type: "object",
        required: [
          "configured",
          "source",
          "status",
          "plan",
          "run",
          "jobs",
          "checks",
          "blockers",
          "redactionSafe",
        ],
        additionalProperties: false,
        properties: {
          configured: { type: "boolean" },
          source: configuredSourceSchema,
          status: liveEvidenceStatusSchema,
          schemaVersion: {
            type: "string",
            enum: ["romeo.hosted-ci-run-verification.v1"],
          },
          generatedAt: { type: "string", format: "date-time" },
          mode: {
            type: "string",
            enum: ["dry-run", "live_github_api", "unknown"],
          },
          invalidReason: invalidReasonSchema,
          provider: { type: "string", enum: ["github_actions", "unknown"] },
          plan: {
            type: "object",
            required: ["requiredStatusCheckCount"],
            additionalProperties: false,
            properties: {
              status: embeddedEvidenceStatusSchema,
              requiredStatusCheckCount: { type: "integer", minimum: 0 },
            },
          },
          run: {
            type: "object",
            required: ["observed", "completed", "successful"],
            additionalProperties: false,
            properties: {
              observed: { type: "boolean" },
              completed: { type: "boolean" },
              successful: { type: "boolean" },
            },
          },
          jobs: {
            type: "object",
            required: [
              "inventoryRead",
              "observedJobCount",
              "missingRequiredJobCount",
              "failedRequiredJobCount",
            ],
            additionalProperties: false,
            properties: {
              inventoryRead: { type: "boolean" },
              observedJobCount: { type: "integer", minimum: 0 },
              missingRequiredJobCount: { type: "integer", minimum: 0 },
              failedRequiredJobCount: { type: "integer", minimum: 0 },
            },
          },
          checks: checkSummarySchema,
          blockers: blockerSummarySchema,
          redactionSafe: { type: "boolean" },
        },
      },
      branchProtection: {
        type: "object",
        required: [
          "configured",
          "source",
          "status",
          "plan",
          "controls",
          "checks",
          "blockers",
          "redactionSafe",
        ],
        additionalProperties: false,
        properties: {
          configured: { type: "boolean" },
          source: configuredSourceSchema,
          status: liveEvidenceStatusSchema,
          schemaVersion: {
            type: "string",
            enum: ["romeo.branch-protection-verification.v1"],
          },
          generatedAt: { type: "string", format: "date-time" },
          mode: {
            type: "string",
            enum: ["dry-run", "live_github_api", "unknown"],
          },
          invalidReason: invalidReasonSchema,
          provider: { type: "string", enum: ["github", "unknown"] },
          plan: {
            type: "object",
            required: ["requiredStatusCheckCount", "policy"],
            additionalProperties: false,
            properties: {
              status: embeddedEvidenceStatusSchema,
              requiredStatusCheckCount: { type: "integer", minimum: 0 },
              policy: policySummarySchema,
            },
          },
          controls: {
            type: "object",
            required: [
              "evaluatedCount",
              "passedCount",
              "failedCount",
              "plannedCount",
            ],
            additionalProperties: false,
            properties: {
              evaluatedCount: { type: "integer", minimum: 0 },
              passedCount: { type: "integer", minimum: 0 },
              failedCount: { type: "integer", minimum: 0 },
              plannedCount: { type: "integer", minimum: 0 },
            },
          },
          checks: checkSummarySchema,
          blockers: blockerSummarySchema,
          redactionSafe: { type: "boolean" },
        },
      },
      redaction: {
        type: "object",
        required: [
          "branchNamesReturned",
          "evidenceFileBodiesReturned",
          "jobLogsReturned",
          "rawApiResponsesReturned",
          "rawEvidencePathsReturned",
          "rawStatusCheckNamesReturned",
          "repositorySlugsReturned",
          "runUrlsReturned",
          "secretValuesReturned",
          "tokenValuesReturned",
          "workflowBodiesReturned",
        ],
        additionalProperties: false,
        properties: {
          branchNamesReturned: { type: "boolean", enum: [false] },
          evidenceFileBodiesReturned: { type: "boolean", enum: [false] },
          jobLogsReturned: { type: "boolean", enum: [false] },
          rawApiResponsesReturned: { type: "boolean", enum: [false] },
          rawEvidencePathsReturned: { type: "boolean", enum: [false] },
          rawStatusCheckNamesReturned: { type: "boolean", enum: [false] },
          repositorySlugsReturned: { type: "boolean", enum: [false] },
          runUrlsReturned: { type: "boolean", enum: [false] },
          secretValuesReturned: { type: "boolean", enum: [false] },
          tokenValuesReturned: { type: "boolean", enum: [false] },
          workflowBodiesReturned: { type: "boolean", enum: [false] },
        },
      },
      warnings: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "ci_branch_protection_plan_blocked",
            "ci_branch_protection_plan_invalid",
            "ci_branch_protection_plan_not_configured",
            "ci_branch_protection_verification_failed",
            "ci_branch_protection_verification_invalid",
            "ci_branch_protection_verification_not_configured",
            "ci_branch_protection_verification_not_live",
            "ci_governance_evidence_missing",
            "ci_governance_redaction_flags_unsafe",
            "ci_hosted_run_verification_failed",
            "ci_hosted_run_verification_invalid",
            "ci_hosted_run_verification_not_configured",
            "ci_hosted_run_verification_not_live",
          ],
        },
      },
    },
  },
};
