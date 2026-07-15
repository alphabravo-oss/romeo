import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const outputPath = resolve(
  process.cwd(),
  argValue("--output") ?? "dist/ci/support-bundle-redaction.json",
);
const tempDir = mkdtempSync(join(tmpdir(), "romeo-support-bundle-"));
const rawSentinel = `RAW_SUPPORT_BUNDLE_SENTINEL_${process.pid}`;
const logFile = join(tempDir, "romeo-app.log");
const evidenceDir = join(tempDir, "evidence");
const supportBundle = join(tempDir, "support-bundle.json");

try {
  writeFileSync(
    logFile,
    [
      `prompt=${rawSentinel}`,
      `provider_payload=${rawSentinel}`,
      `token=${rawSentinel}`,
    ].join("\n"),
    "utf8",
  );
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, "raw-evidence.json"),
    JSON.stringify(
      {
        schemaVersion: "romeo.synthetic-raw-evidence.v1",
        status: "passed",
        rawPrompt: rawSentinel,
        rawProviderPayload: rawSentinel,
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(evidenceDir, "access-review-report.json"),
    JSON.stringify(
      {
        schema: "romeo.access-review-report.v1",
        orgId: "org_default",
        generatedAt: new Date().toISOString(),
        users: [
          {
            id: "user_support_bundle",
            email: rawSentinel,
            supportReason: rawSentinel,
          },
        ],
        controls: [
          {
            id: "support_bundle_redaction",
            evidence: { rawTicketBody: rawSentinel },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = spawnSync(
    "node",
    [
      "scripts/generate-support-bundle.mjs",
      "--output",
      supportBundle,
      "--evidence-dir",
      evidenceDir,
      "--log-file",
      logFile,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        AWS_SECRET_ACCESS_KEY: rawSentinel,
        DATA_CONNECTOR_EXECUTION_DRIVER: rawSentinel,
        DATABASE_URL: `postgres://romeo:${rawSentinel}@db.example/romeo`,
        LOCAL_AUTH_SECRET_ENCRYPTION_KEY: rawSentinel,
        MANAGED_SECRET_ENCRYPTION_KEY: rawSentinel,
        ROMEO_API_KEY: rawSentinel,
        SESSION_SECRET: rawSentinel,
        TENANCY_MODE: rawSentinel,
        WEBHOOK_SIGNING_KEY: rawSentinel,
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Support bundle generation failed: ${result.stderr || result.stdout}`,
    );
  }

  const serialized = readFileSync(supportBundle, "utf8");
  if (serialized.includes(rawSentinel)) {
    throw new Error("Support bundle leaked a raw sentinel.");
  }
  const bundle = JSON.parse(serialized);
  if (bundle.schemaVersion !== "romeo.support-bundle.v1") {
    throw new Error("Support bundle schema version mismatch.");
  }
  if (bundle.logs?.[0]?.basename !== "romeo-app.log") {
    throw new Error("Support bundle did not include log metadata.");
  }
  if (
    !bundle.evidence?.some(
      (item) => item.schemaVersion === "romeo.synthetic-raw-evidence.v1",
    )
  ) {
    throw new Error("Support bundle did not summarize evidence metadata.");
  }
  const accessReviewEvidence = bundle.complianceEvidence?.accessReview;
  const accessReviewArtifact = accessReviewEvidence?.artifacts?.[0];
  if (
    accessReviewEvidence?.status !== "present" ||
    accessReviewEvidence.count !== 1 ||
    accessReviewArtifact?.schemaVersion !== "romeo.access-review-report.v1" ||
    !accessReviewArtifact.path.endsWith("access-review-report.json")
  ) {
    throw new Error("Support bundle did not link access-review evidence.");
  }
  if (
    bundle.configuration?.configuredSecrets?.DATABASE_URL !== true ||
    bundle.configuration?.configuredSecrets
      ?.LOCAL_AUTH_SECRET_ENCRYPTION_KEY !== true ||
    bundle.configuration?.configuredSecrets?.MANAGED_SECRET_ENCRYPTION_KEY !==
      true ||
    bundle.configuration?.configuredSecrets?.SESSION_SECRET !== true
  ) {
    throw new Error("Support bundle did not record configured-secret posture.");
  }
  if (
    bundle.configuration?.safeEnums?.DATA_CONNECTOR_EXECUTION_DRIVER !==
      "configured_unrecognized" ||
    bundle.configuration?.safeEnums?.TENANCY_MODE !== "configured_unrecognized"
  ) {
    throw new Error("Support bundle did not redact unrecognized enum posture.");
  }

  const evidence = {
    schemaVersion: "romeo.support-bundle-redaction.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "support_bundle_generation",
      "raw_log_content_not_included",
      "raw_evidence_content_not_included",
      "access_review_evidence_linked_without_raw_content",
      "environment_secret_values_not_included",
      "configured_secret_posture_recorded",
      "unrecognized_enum_values_not_included",
    ],
    supportBundle: {
      schemaVersion: bundle.schemaVersion,
      evidenceCount: bundle.evidence.length,
      accessReviewEvidenceCount: bundle.complianceEvidence.accessReview.count,
      logCount: bundle.logs.length,
      migrationCount: bundle.migrations.count,
      configuredSecretKeys: Object.entries(
        bundle.configuration.configuredSecrets,
      )
        .filter(([, configured]) => configured === true)
        .map(([key]) => key)
        .sort(),
    },
    redaction: {
      rawLogContentReturned: false,
      rawEvidenceContentReturned: false,
      accessReviewRawContentReturned: false,
      environmentSecretValuesReturned: false,
      unrecognizedEnumValuesReturned: false,
    },
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Wrote support bundle redaction evidence to ${outputPath}`);
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
