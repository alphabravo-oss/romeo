import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { readJson, repoPath } from "./lib/release-artifacts.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "romeo-container-security-"));
const now = "2026-08-23T20:00:00.000Z";
const stale = "2026-08-21T20:00:00.000Z";
const digests = {
  app: `sha256:${"a".repeat(64)}`,
  ops: `sha256:${"b".repeat(64)}`,
  wrong: `sha256:${"c".repeat(64)}`,
};

try {
  fixture("artifact.tgz", "artifact");
  const manifest = fixture("release-manifest.json", {
    name: "romeo",
    version: "0.1.0",
    artifacts: [
      {
        name: "@romeo/cli",
        version: "0.1.0",
        file: "artifact.tgz",
        bytes: 8,
        sha256:
          "c7c5c1d70c5dec44cc25f8e3f2a7a25b13000ed682cb7421f7921d2fc3f7b00d",
      },
    ],
  });
  const imageManifest = fixture("container-images.json", {
    schemaVersion: "romeo.container-image-manifest.v1",
    generatedAt: now,
    images: [
      { role: "app", reference: "romeo/app:0.1.0", digest: digests.app },
      { role: "ops", reference: "romeo/ops:0.1.0", digest: digests.ops },
    ],
  });
  const cleanApp = scan("clean-app.json", "app", digests.app, now);
  const cleanOps = scan("clean-ops.json", "ops", digests.ops, now);

  const results = [];
  results.push(
    runCase("clean_images", {
      scans: [cleanApp, cleanOps],
      status: 0,
    }),
  );
  results.push(
    runCase("missing_scan", {
      scans: [cleanApp],
      failureCode: "container_scan_missing",
    }),
  );
  results.push(
    runCase("wrong_digest", {
      scans: [cleanApp, scan("wrong-ops.json", "ops", digests.wrong, now)],
      failureCode: "container_scan_digest_mismatch",
    }),
  );
  results.push(
    runCase("stale_scan", {
      scans: [cleanApp, scan("stale-ops.json", "ops", digests.ops, stale)],
      failureCode: "container_scan_stale",
    }),
  );
  const highApp = scan("high-app.json", "app", digests.app, now, {
    Vulnerabilities: [{ VulnerabilityID: "CVE-2099-0001", Severity: "HIGH" }],
  });
  results.push(
    runCase("high_cve", {
      scans: [highApp, cleanOps],
      failureCode: "vulnerability_threshold_exceeded",
    }),
  );
  const exceptions = fixture("exceptions.json", {
    schemaVersion: "romeo.container-scan-exceptions.v1",
    exceptions: [
      {
        type: "vulnerability",
        id: "CVE-2099-0001",
        imageRole: "app",
        expiresAt: "2026-08-30T20:00:00.000Z",
        reason: "Reviewed temporary upstream exception",
      },
    ],
  });
  results.push(
    runCase("allowed_exception", {
      scans: [highApp, cleanOps],
      exceptions,
      status: 0,
      assertEvidence: (evidence) => {
        if (evidence.findings?.exceptionsApplied?.length !== 1)
          throw new Error("Allowed exception was not recorded.");
      },
    }),
  );
  results.push(
    runCase("secret_finding", {
      scans: [
        scan("secret-app.json", "app", digests.app, now, {
          Secrets: [{ RuleID: "private-key", Severity: "CRITICAL" }],
        }),
        cleanOps,
      ],
      failureCode: "container_secret_detected",
    }),
  );
  results.push(
    runCase("denied_license", {
      scans: [
        scan("license-app.json", "app", digests.app, now, {
          Licenses: [{ Name: "AGPL-3.0-only" }],
        }),
        cleanOps,
      ],
      failureCode: "container_license_denied",
    }),
  );
  const malformed = fixture("malformed.json", {});
  results.push(
    runCase("malformed_report", {
      scans: [malformed, cleanOps],
      expectStructuralFailure: true,
    }),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "romeo.security-evidence-container-scan-smoke.v1",
        generatedAt: new Date().toISOString(),
        status: "passed",
        cases: results,
      },
      null,
      2,
    )}\n`,
  );

  function runCase(
    name,
    {
      scans,
      exceptions: exceptionPath,
      failureCode,
      status = 1,
      assertEvidence,
      expectStructuralFailure = false,
    },
  ) {
    const output = join(tempDir, `${name}-evidence.json`);
    const args = [
      repoPath("scripts/generate-security-evidence.mjs"),
      "--manifest",
      manifest,
      "--container-image-manifest",
      imageManifest,
      "--skip-audit",
      "--generated-at",
      now,
      "--scan-max-age-seconds",
      "3600",
      "--output",
      output,
      ...scans.flatMap((path) => ["--container-scan-file", path]),
      ...(exceptionPath === undefined
        ? []
        : ["--container-policy-exceptions", exceptionPath]),
    ];
    const result = spawnSync(process.execPath, args, {
      cwd: repoPath("."),
      encoding: "utf8",
    });
    if (result.status !== status)
      throw new Error(`${name} exited ${result.status}: ${result.stderr}`);
    if (expectStructuralFailure) {
      if (!result.stderr.includes("is not a Romeo Trivy scan report"))
        throw new Error(`${name} did not reject the malformed report.`);
      return { name, status: "passed", rejected: true };
    }
    const evidence = readJson(output);
    if (status === 0 && evidence.status !== "pass")
      throw new Error(`${name} did not produce passing evidence.`);
    if (
      failureCode !== undefined &&
      !evidence.failures?.some((failure) => failure.code === failureCode)
    ) {
      throw new Error(`${name} did not report ${failureCode}.`);
    }
    assertEvidence?.(evidence);
    return {
      name,
      status: "passed",
      expectedExitStatus: status,
      failureCode,
    };
  }

  function scan(name, role, digest, generatedAt, result = {}) {
    return fixture(name, {
      schemaVersion: "romeo.container-scan-report.v1",
      generatedAt,
      image: {
        role,
        reference: `romeo/${role}:0.1.0`,
        digest,
      },
      scanner: { name: "trivy", format: "trivy-json" },
      report: {
        SchemaVersion: 2,
        Metadata: { ImageID: digest },
        Results: [{ Target: role, ...result }],
      },
    });
  }

  function fixture(name, value) {
    const path = join(tempDir, name);
    writeFileSync(
      path,
      typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
      "utf8",
    );
    return path;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
