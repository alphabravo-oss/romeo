import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthSubject } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import { describe, expect, it } from "vitest";

import { AnalyticsAuthzPostureService } from "./services/analytics-authz-posture-service";
import { IdentityLivePostureService } from "./services/identity-live-posture-service";

const subject: AuthSubject = {
  id: "user_enterprise_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_admins"],
  scopes: ["admin:read"],
  isAdmin: true,
};

describe("enterprise live posture strictness", () => {
  it("returns live GA failure codes without echoing evidence failure strings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-live-posture-"));
    const rawFailure = "RAW_ENTERPRISE_LIVE_FAILURE_SENTINEL";
    const cases = [
      {
        name: "identity-live",
        report: (path: string) =>
          new IdentityLivePostureService(
            readEnv({ IDENTITY_LIVE_EVIDENCE_PATH: path }),
          ).report(subject),
        evidence: identityLiveEvidence({
          directory: {
            ...identityLiveEvidence().directory,
            policyViolationCount: 1,
          },
          failures: [rawFailure],
        }),
        failureCodes: [
          "identity_live_directory_missing",
          "identity_live_failure_codes_present",
        ],
        warnings: [
          "identity_live_directory_missing",
          "identity_live_failure_codes_present",
        ],
      },
      {
        name: "analytics-authz",
        report: (path: string) =>
          new AnalyticsAuthzPostureService(
            readEnv({ ANALYTICS_AUTHZ_EVIDENCE_PATH: path }),
          ).report(subject),
        evidence: analyticsAuthzEvidence({
          failures: [rawFailure],
          subjects: {
            ...analyticsAuthzEvidence().subjects,
            crossOrgSubjectCount: 0,
          },
        }),
        failureCodes: [
          "analytics_authz_live_subjects_missing",
          "analytics_authz_live_failure_codes_present",
        ],
        warnings: [
          "analytics_authz_live_subjects_missing",
          "analytics_authz_live_failure_codes_present",
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const evidencePath = join(directory, `${testCase.name}.json`);
      writeFileSync(evidencePath, JSON.stringify(testCase.evidence), "utf8");
      const report = await testCase.report(evidencePath);
      const serialized = JSON.stringify(report);

      expect(report.status).toBe("attention_required");
      expect(report.evidence.status).toBe("failed");
      for (const code of testCase.failureCodes) {
        expect(report.evidence.failureCodes).toContain(code);
      }
      for (const warning of testCase.warnings) {
        expect(report.warnings).toContain(warning);
      }
      expect(serialized).not.toContain(rawFailure);
      expect(serialized).not.toContain(evidencePath);
      expect(serialized).not.toContain(directory);
    }
  });
});

function identityLiveEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "romeo.identity-live-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "kubernetes",
    checks: [
      "managed_secret_backend_live",
      "configured_idp_login_live",
      "directory_lookup_live",
      "group_mapping_validation_live",
      "directory_sync_preview_live",
      "directory_sync_apply_live",
      "deprovision_or_scim_lifecycle_live",
      "access_review_readback",
      "identity_log_redaction",
      "identity_evidence_redaction_reviewed",
    ],
    identityProviders: {
      configuredProviderCount: 1,
      liveLoginProviderCount: 1,
      oidcProviderCount: 1,
      oauth2ProviderCount: 0,
      ldapProviderCount: 0,
      samlProviderCount: 0,
      localFallbackVerified: true,
      mfaFallbackVerified: true,
    },
    secretBackends: {
      managedSecretBackendCount: 1,
      vaultSecretWriteCount: 1,
      externalSecretReferenceCount: 1,
      secretResolutionCheckCount: 1,
    },
    directory: {
      directoryProviderCount: 1,
      directoryLookupCount: 1,
      mappedGroupCount: 1,
      workspaceMappingCount: 1,
      directorySyncPreviewChangeCount: 1,
      directorySyncAppliedChangeCount: 1,
      policyViolationCount: 0,
    },
    lifecycle: {
      deprovisionedUserCount: 1,
      scimUserLifecycleCount: 0,
      scimGroupLifecycleCount: 0,
      disabledUserCount: 0,
      revokedSessionCount: 1,
    },
    accessReview: {
      checked: true,
      reportUserCount: 1,
      reportGroupCount: 1,
      reportGrantCount: 1,
      exportedCsv: true,
    },
    redaction: {
      evidenceFileBodiesReturned: false,
      rawDirectoryEntriesReturned: false,
      rawEmailAddressesReturned: false,
      rawEvidencePathsReturned: false,
      rawGroupNamesReturned: false,
      rawIdpResponsesReturned: false,
      rawLdapDnsReturned: false,
      rawProviderEndpointsReturned: false,
      rawSamlAssertionsReturned: false,
      rawSecretRefsReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
    ...overrides,
  };
}

function analyticsAuthzEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "romeo.analytics-authz-live-evidence.v1",
    status: "passed",
    mode: "live",
    deployment: "target",
    checks: [
      "admin_summary_readback",
      "admin_csv_export_readback",
      "usage_scope_enforced",
      "eval_evidence_resource_grant_enforced",
      "non_admin_summary_denied",
      "non_admin_csv_denied",
      "cross_org_summary_denied",
      "cross_workspace_export_scoped",
      "csv_export_hash_recorded",
      "raw_analytics_content_absent",
      "analytics_log_redaction",
      "analytics_evidence_redaction_reviewed",
    ],
    subjects: {
      adminSubjectCount: 1,
      orgAdminSubjectCount: 1,
      nonAdminSubjectCount: 1,
      serviceAccountSubjectCount: 1,
      crossOrgSubjectCount: 1,
    },
    authorization: {
      adminSummaryAllowedCount: 1,
      adminCsvAllowedCount: 1,
      nonAdminSummaryDeniedCount: 1,
      nonAdminCsvDeniedCount: 1,
      missingUsageScopeDeniedCount: 1,
      evalGrantDeniedCount: 1,
      crossOrgDeniedCount: 1,
      crossWorkspaceScopedCount: 1,
    },
    analytics: {
      summaryReadCount: 1,
      csvExportReadCount: 1,
      evalEvidenceReadCount: 1,
      csvSha256Count: 1,
      usageMetricCount: 1,
      evalSuiteCount: 1,
      jobSummaryCount: 1,
      providerSummaryCount: 1,
    },
    redaction: {
      apiKeysReturned: false,
      evidenceFileBodiesReturned: false,
      rawAnalyticsCsvRowsReturned: false,
      rawEvalInputsReturned: false,
      rawEvalOutputsReturned: false,
      rawEvidencePathsReturned: false,
      rawHumanRatingCommentsReturned: false,
      rawJobPayloadsReturned: false,
      rawOrgNamesReturned: false,
      rawProviderConfigReturned: false,
      rawSecretRefsReturned: false,
      rawToolInputsReturned: false,
      rawUsageMetadataReturned: false,
      rawUserEmailsReturned: false,
      rawWorkspaceNamesReturned: false,
      secretValuesReturned: false,
      tokenValuesReturned: false,
    },
    ...overrides,
  };
}
