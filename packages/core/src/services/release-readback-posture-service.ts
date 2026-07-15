import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { readFile } from "node:fs/promises";

const requiredReleaseAssetNames = [
  "release-channel",
  "security-evidence",
  "sbom",
  "provenance",
  "approval",
] as const;

const validationRedactionFlags = [
  "tokenValuesReturned",
  "rawReadbackBodyReturned",
  "rawRegistryResponsesReturned",
  "rawPackageTarballsReturned",
  "rawOciManifestsReturned",
  "rawHelmRepositoryBodiesReturned",
  "rawReleaseAssetBodiesReturned",
  "environmentReturned",
] as const;

type ReleaseReadbackInvalidReason =
  | "invalid_json"
  | "read_failed"
  | "schema_mismatch";

export type ReleaseReadbackPostureWarning =
  | "release_readback_evidence_invalid"
  | "release_readback_evidence_not_collected"
  | "release_readback_evidence_not_configured"
  | "release_readback_evidence_not_live"
  | "release_readback_plan_blocked"
  | "release_readback_plan_invalid"
  | "release_readback_plan_not_configured"
  | "release_readback_required_artifacts_missing"
  | "release_readback_validation_failed"
  | "release_readback_validation_invalid"
  | "release_readback_validation_not_configured"
  | "release_readback_validation_not_live"
  | "release_readback_validation_redaction_missing";

export interface ReleaseReadbackPostureReport {
  schema: "romeo.release-readback-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  summary: {
    planReady: boolean;
    readbackSatisfied: boolean;
    validationPassed: boolean;
    requiredPackageCount: number;
    requiredImageCount: number;
    requiredChartCount: number;
    requiredAssetCount: number;
    requiredReleaseAssetNamesFound: string[];
    validationCheckCount: number;
    validationChecksPassed: number;
    validationChecksFailed: number;
  };
  plan: ReleaseReadbackPlanPosture;
  readback: ReleaseReadbackEvidencePosture;
  validation: ReleaseReadbackValidationPosture;
  redaction: {
    evidenceFileBodiesReturned: false;
    helmRepositoryUrlsReturned: false;
    ociImageRefsReturned: false;
    packageRegistryUrlsReturned: false;
    packageTarballsReturned: false;
    rawEvidencePathsReturned: false;
    rawHelmRepositoryBodiesReturned: false;
    rawOciManifestsReturned: false;
    rawReadbackBodiesReturned: false;
    rawRegistryResponsesReturned: false;
    releaseAssetUrlsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: ReleaseReadbackPostureWarning[];
}

export interface ReleaseReadbackPlanPosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "blocked" | "invalid" | "not_configured" | "ready";
  schemaVersion?: "romeo.release-readback-plan.v1";
  invalidReason?: ReleaseReadbackInvalidReason;
  failureCodes: string[];
  helmRepositoryConfigured: boolean;
  images: {
    total: number;
    digestPinned: number;
    requiredMatched: number;
  };
  charts: {
    total: number;
    digestPinned: number;
    requiredMatched: number;
  };
  assets: {
    total: number;
    digestPinned: number;
    requiredMatched: number;
    requiredReleaseAssetNamesFound: string[];
    requiredReleaseAssetNamesMissing: string[];
  };
}

export interface ReleaseReadbackEvidencePosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "failed" | "invalid" | "not_configured" | "planned" | "satisfied";
  schemaVersion?: "romeo.release-readback.v1";
  generatedAt?: string;
  mode?: "dry-run" | "live_registry_readback" | "unknown";
  evidenceStatus?: "collected" | "planned" | "unknown";
  invalidReason?: ReleaseReadbackInvalidReason;
  release?: {
    name?: string;
    version?: string;
  };
  registries: {
    npmCredentialsUsed: boolean;
    ociCredentialsUsed: boolean;
    helmCredentialsUsed: boolean;
    assetCredentialsUsed: boolean;
  };
  artifacts: {
    packages: number;
    images: number;
    ociRegistryImages: number;
    charts: number;
    helmRepositoryCharts: number;
    assets: number;
    releaseAssets: number;
  };
  failureCodes: string[];
}

export interface ReleaseReadbackValidationPosture {
  configured: boolean;
  source: "configured_file" | "not_configured";
  status: "failed" | "invalid" | "not_configured" | "passed" | "planned";
  schemaVersion?: "romeo.release-readback-validation.v1";
  generatedAt?: string;
  mode?: "live_readback" | "planned_readback" | "unknown";
  validationStatus?: "fail" | "pass" | "unknown";
  invalidReason?: ReleaseReadbackInvalidReason;
  release?: {
    name?: string;
    version?: string;
  };
  required: {
    packages: number;
    images: number;
    charts: number;
    assets: number;
    requiredReleaseAssetNamesFound: string[];
    requiredReleaseAssetNamesMissing: string[];
  };
  verified: {
    credentialedNpmRegistry: boolean;
    images: number;
    charts: number;
    releaseAssets: number;
  };
  checks: {
    total: number;
    passed: number;
    failed: number;
  };
  redactionProof: {
    status: "failed" | "passed";
    requiredFlagCount: number;
    safeFlagCount: number;
    unsafeFlagCount: number;
    missingFlagCount: number;
  };
  failureCodes: string[];
}

export class ReleaseReadbackPostureService {
  constructor(private readonly env: RomeoEnv) {}

  async report(subject: AuthSubject): Promise<ReleaseReadbackPostureReport> {
    assertScope(subject, "admin:read");

    const plan = await summarizePlan(this.env.RELEASE_READBACK_PLAN_PATH);
    const readback = await summarizeReadback(
      this.env.RELEASE_READBACK_EVIDENCE_PATH,
    );
    const validation = await summarizeValidation(
      this.env.RELEASE_READBACK_VALIDATION_PATH,
    );
    const warnings = releaseReadbackWarnings({ plan, readback, validation });

    return {
      schema: "romeo.release-readback-posture.v1",
      generatedAt: new Date().toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      summary: {
        planReady: plan.status === "ready",
        readbackSatisfied: readback.status === "satisfied",
        validationPassed: validation.status === "passed",
        requiredPackageCount: validation.required.packages,
        requiredImageCount: validation.required.images,
        requiredChartCount: validation.required.charts,
        requiredAssetCount: validation.required.assets,
        requiredReleaseAssetNamesFound:
          validation.required.requiredReleaseAssetNamesFound,
        validationCheckCount: validation.checks.total,
        validationChecksPassed: validation.checks.passed,
        validationChecksFailed: validation.checks.failed,
      },
      plan,
      readback,
      validation,
      redaction: releaseReadbackRedaction(),
      warnings,
    };
  }
}

async function summarizePlan(
  evidencePath: string,
): Promise<ReleaseReadbackPlanPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyPlan("not_configured", []);
  }
  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyPlan("invalid", [result.invalidReason], result.invalidReason);
  }
  const plan = result.data;
  if (plan.schemaVersion !== "romeo.release-readback-plan.v1") {
    return emptyPlan("invalid", ["schema_mismatch"], "schema_mismatch");
  }

  const helmRepositoryConfigured =
    stringValue(recordValue(plan.helm).repositoryUrl) !== undefined ||
    stringValue(plan.helmRepositoryUrl) !== undefined;
  const imageSummary = summarizePlanEntries(recordArray(plan.images), "image");
  const chartSummary = summarizePlanEntries(recordArray(plan.charts), "chart");
  const assetSummary = summarizePlanAssets(recordArray(plan.assets));
  const failureCodes = planFailureCodes({
    helmRepositoryConfigured,
    imageSummary,
    chartSummary,
    assetSummary,
  });

  return {
    configured: true,
    source: "configured_file",
    status: failureCodes.length === 0 ? "ready" : "blocked",
    schemaVersion: "romeo.release-readback-plan.v1",
    failureCodes,
    helmRepositoryConfigured,
    images: imageSummary,
    charts: chartSummary,
    assets: assetSummary,
  };
}

function emptyPlan(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  invalidReason?: ReleaseReadbackInvalidReason,
): ReleaseReadbackPlanPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    failureCodes,
    helmRepositoryConfigured: false,
    images: { total: 0, digestPinned: 0, requiredMatched: 0 },
    charts: { total: 0, digestPinned: 0, requiredMatched: 0 },
    assets: {
      total: 0,
      digestPinned: 0,
      requiredMatched: 0,
      requiredReleaseAssetNamesFound: [],
      requiredReleaseAssetNamesMissing: [...requiredReleaseAssetNames],
    },
  };
}

async function summarizeReadback(
  evidencePath: string,
): Promise<ReleaseReadbackEvidencePosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyReadback("not_configured", []);
  }
  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyReadback(
      "invalid",
      [result.invalidReason],
      result.invalidReason,
    );
  }
  const data = result.data;
  if (data.schemaVersion !== "romeo.release-readback.v1") {
    return emptyReadback("invalid", ["schema_mismatch"], "schema_mismatch");
  }

  const mode = readbackMode(data.mode);
  const evidenceStatus = readbackEvidenceStatus(data.status);
  const registries = registryCredentialSummary(data.registries);
  const packages = recordArray(data.packages);
  const images = recordArray(data.images);
  const charts = recordArray(data.helmCharts);
  const assets = recordArray(data.assets);
  const artifacts = {
    packages: packages.length,
    images: images.length,
    ociRegistryImages: images.filter((item) => item.source === "oci_registry")
      .length,
    charts: charts.length,
    helmRepositoryCharts: charts.filter(
      (item) => item.source === "helm_repository",
    ).length,
    assets: assets.length,
    releaseAssets: assets.filter((item) => item.source === "release_asset")
      .length,
  };
  const failureCodes = readbackFailureCodes({
    artifacts,
    evidenceStatus,
    mode,
    registries,
  });
  const status =
    mode === "dry-run" || evidenceStatus === "planned"
      ? "planned"
      : failureCodes.length === 0
        ? "satisfied"
        : "failed";
  const generatedAt = stringValue(data.generatedAt);
  const release = releaseSummary(data.release);

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.release-readback.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    mode,
    evidenceStatus,
    ...(release === undefined ? {} : { release }),
    registries,
    artifacts,
    failureCodes,
  };
}

function emptyReadback(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  invalidReason?: ReleaseReadbackInvalidReason,
): ReleaseReadbackEvidencePosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    registries: {
      npmCredentialsUsed: false,
      ociCredentialsUsed: false,
      helmCredentialsUsed: false,
      assetCredentialsUsed: false,
    },
    artifacts: {
      packages: 0,
      images: 0,
      ociRegistryImages: 0,
      charts: 0,
      helmRepositoryCharts: 0,
      assets: 0,
      releaseAssets: 0,
    },
    failureCodes,
  };
}

async function summarizeValidation(
  evidencePath: string,
): Promise<ReleaseReadbackValidationPosture> {
  const configuredPath = evidencePath.trim();
  if (configuredPath.length === 0) {
    return emptyValidation("not_configured", []);
  }
  const result = await readJson(configuredPath);
  if (result.status === "invalid") {
    return emptyValidation(
      "invalid",
      [result.invalidReason],
      result.invalidReason,
    );
  }
  const data = result.data;
  if (data.schemaVersion !== "romeo.release-readback-validation.v1") {
    return emptyValidation("invalid", ["schema_mismatch"], "schema_mismatch");
  }

  const mode = validationMode(data.mode);
  const validationStatus = validationStatusValue(data.status);
  const checks = validationCheckSummary(data.checks);
  const required = validationRequiredSummary(data.required);
  const verified = validationVerifiedSummary({
    checksValue: data.checks,
    requiredValue: data.required,
  });
  const redactionProof = validationRedactionProof(data.redaction);
  const failureCodes = validationFailureCodes({
    mode,
    redactionProof,
    required,
    validationStatus,
    verified,
  });
  const status =
    mode === "planned_readback"
      ? "planned"
      : validationStatus === "pass" && failureCodes.length === 0
        ? "passed"
        : "failed";
  const generatedAt = stringValue(data.generatedAt);
  const release = releaseSummary(recordValue(data.release));

  return {
    configured: true,
    source: "configured_file",
    status,
    schemaVersion: "romeo.release-readback-validation.v1",
    ...(generatedAt === undefined ? {} : { generatedAt }),
    mode,
    validationStatus,
    ...(release === undefined ? {} : { release }),
    required,
    verified,
    checks,
    redactionProof,
    failureCodes,
  };
}

function emptyValidation(
  status: "invalid" | "not_configured",
  failureCodes: string[],
  invalidReason?: ReleaseReadbackInvalidReason,
): ReleaseReadbackValidationPosture {
  return {
    configured: status !== "not_configured",
    source: status === "not_configured" ? "not_configured" : "configured_file",
    status,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    required: {
      packages: 0,
      images: 0,
      charts: 0,
      assets: 0,
      requiredReleaseAssetNamesFound: [],
      requiredReleaseAssetNamesMissing: [...requiredReleaseAssetNames],
    },
    verified: {
      credentialedNpmRegistry: false,
      images: 0,
      charts: 0,
      releaseAssets: 0,
    },
    checks: { total: 0, passed: 0, failed: 0 },
    redactionProof: {
      status: "failed",
      requiredFlagCount: validationRedactionFlags.length,
      safeFlagCount: 0,
      unsafeFlagCount: 0,
      missingFlagCount: validationRedactionFlags.length,
    },
    failureCodes,
  };
}

type ReadJsonResult =
  | { status: "valid"; data: Record<string, unknown> }
  | { status: "invalid"; invalidReason: ReleaseReadbackInvalidReason };

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

function summarizePlanEntries(
  entries: Record<string, unknown>[],
  kind: "chart" | "image",
): PlanEntrySummary {
  return entries.reduce<PlanEntrySummary>(
    (summary, entry) => {
      const readback = stringValue(entry.readback);
      const required = stringValue(entry.required);
      summary.total += 1;
      if (readback !== undefined && sha256Pinned(readback)) {
        summary.digestPinned += 1;
      }
      if (
        readback !== undefined &&
        required !== undefined &&
        releasePlanReadbackIdentity(readback, kind) === required
      ) {
        summary.requiredMatched += 1;
      }
      return summary;
    },
    { total: 0, digestPinned: 0, requiredMatched: 0 },
  );
}

interface PlanEntrySummary {
  total: number;
  digestPinned: number;
  requiredMatched: number;
}

function summarizePlanAssets(
  entries: Record<string, unknown>[],
): PlanAssetSummary {
  const requiredNames = new Set<string>();
  const summary = entries.reduce<PlanEntrySummary>(
    (current, entry) => {
      const readback = stringValue(entry.readback);
      const required = stringValue(entry.required);
      current.total += 1;
      if (readback !== undefined && sha256Pinned(readback)) {
        current.digestPinned += 1;
      }
      const readbackAsset = releasePlanAsset(readback);
      const requiredAsset = releasePlanRequiredAsset(required);
      if (
        readbackAsset !== undefined &&
        requiredAsset !== undefined &&
        readbackAsset.name === requiredAsset.name &&
        readbackAsset.sha256 === requiredAsset.sha256
      ) {
        current.requiredMatched += 1;
      }
      if (
        requiredAsset !== undefined &&
        requiredReleaseAssetNames.includes(
          requiredAsset.name as (typeof requiredReleaseAssetNames)[number],
        )
      ) {
        requiredNames.add(requiredAsset.name);
      }
      return current;
    },
    { total: 0, digestPinned: 0, requiredMatched: 0 },
  );
  const found = requiredReleaseAssetNames.filter((name) =>
    requiredNames.has(name),
  );
  return {
    ...summary,
    requiredReleaseAssetNamesFound: found,
    requiredReleaseAssetNamesMissing: requiredReleaseAssetNames.filter(
      (name) => !requiredNames.has(name),
    ),
  };
}

interface PlanAssetSummary extends PlanEntrySummary {
  total: number;
  digestPinned: number;
  requiredMatched: number;
  requiredReleaseAssetNamesFound: string[];
  requiredReleaseAssetNamesMissing: string[];
}

function planFailureCodes(input: {
  helmRepositoryConfigured: boolean;
  imageSummary: {
    total: number;
    digestPinned: number;
    requiredMatched: number;
  };
  chartSummary: {
    total: number;
    digestPinned: number;
    requiredMatched: number;
  };
  assetSummary: {
    total: number;
    digestPinned: number;
    requiredMatched: number;
    requiredReleaseAssetNamesMissing: string[];
  };
}): string[] {
  const failures: string[] = [];
  if (!input.helmRepositoryConfigured) failures.push("helm_repository_missing");
  if (input.imageSummary.total < 1) failures.push("required_image_missing");
  if (input.chartSummary.total < 1) failures.push("required_chart_missing");
  if (input.assetSummary.requiredReleaseAssetNamesMissing.length > 0) {
    failures.push("required_release_assets_missing");
  }
  if (
    input.imageSummary.total > 0 &&
    input.imageSummary.digestPinned !== input.imageSummary.total
  ) {
    failures.push("image_digest_pin_missing");
  }
  if (
    input.imageSummary.total > 0 &&
    input.imageSummary.requiredMatched !== input.imageSummary.total
  ) {
    failures.push("image_required_mismatch");
  }
  if (
    input.chartSummary.total > 0 &&
    input.chartSummary.digestPinned !== input.chartSummary.total
  ) {
    failures.push("chart_digest_pin_missing");
  }
  if (
    input.chartSummary.total > 0 &&
    input.chartSummary.requiredMatched !== input.chartSummary.total
  ) {
    failures.push("chart_required_mismatch");
  }
  if (
    input.assetSummary.total > 0 &&
    input.assetSummary.digestPinned !== input.assetSummary.total
  ) {
    failures.push("release_asset_digest_pin_missing");
  }
  if (
    input.assetSummary.total > 0 &&
    input.assetSummary.requiredMatched !== input.assetSummary.total
  ) {
    failures.push("release_asset_required_mismatch");
  }
  return failures;
}

function readbackFailureCodes(input: {
  artifacts: ReleaseReadbackEvidencePosture["artifacts"];
  evidenceStatus: "collected" | "planned" | "unknown";
  mode: "dry-run" | "live_registry_readback" | "unknown";
  registries: ReleaseReadbackEvidencePosture["registries"];
}): string[] {
  const failures: string[] = [];
  if (input.mode !== "live_registry_readback") {
    failures.push("release_readback_not_live");
  }
  if (input.evidenceStatus !== "collected") {
    failures.push("release_readback_not_collected");
  }
  if (input.artifacts.packages < 1) failures.push("packages_missing");
  if (!input.registries.npmCredentialsUsed) {
    failures.push("npm_credentials_not_used");
  }
  if (input.artifacts.images > 0 && !input.registries.ociCredentialsUsed) {
    failures.push("oci_credentials_not_used");
  }
  if (input.artifacts.charts > 0 && !input.registries.helmCredentialsUsed) {
    failures.push("helm_credentials_not_used");
  }
  if (input.artifacts.assets > 0 && !input.registries.assetCredentialsUsed) {
    failures.push("release_asset_credentials_not_used");
  }
  return failures;
}

function validationFailureCodes(input: {
  mode: "live_readback" | "planned_readback" | "unknown";
  redactionProof: ReleaseReadbackValidationPosture["redactionProof"];
  required: ReleaseReadbackValidationPosture["required"];
  validationStatus: "fail" | "pass" | "unknown";
  verified: ReleaseReadbackValidationPosture["verified"];
}): string[] {
  const failures: string[] = [];
  if (input.mode !== "live_readback") {
    failures.push("release_readback_validation_not_live");
  }
  if (input.validationStatus !== "pass") {
    failures.push("release_readback_validation_not_passed");
  }
  if (!input.verified.credentialedNpmRegistry) {
    failures.push("credentialed_npm_registry_readback_missing");
  }
  if (input.required.packages < 1) {
    failures.push("required_packages_missing");
  }
  if (input.required.images < 1) {
    failures.push("required_images_missing");
  } else if (input.verified.images !== input.required.images) {
    failures.push("required_image_readback_not_verified");
  }
  if (input.required.charts < 1) {
    failures.push("required_charts_missing");
  } else if (input.verified.charts !== input.required.charts) {
    failures.push("required_chart_readback_not_verified");
  }
  if (input.required.requiredReleaseAssetNamesMissing.length > 0) {
    failures.push("required_release_assets_missing");
  } else if (input.verified.releaseAssets < requiredReleaseAssetNames.length) {
    failures.push("required_release_asset_readback_not_verified");
  }
  if (input.redactionProof.status !== "passed") {
    failures.push("release_readback_redaction_missing");
  }
  return failures;
}

function validationRequiredSummary(
  value: unknown,
): ReleaseReadbackValidationPosture["required"] {
  const required = recordValue(value);
  const assets = recordArray(required.assets);
  const found = requiredReleaseAssetNames.filter((name) =>
    assets.some((asset) => releaseValidationAssetName(asset) === name),
  );
  return {
    packages: recordArray(required.packages).length,
    images: stringArray(required.images).length,
    charts: recordArray(required.charts).length,
    assets: assets.length,
    requiredReleaseAssetNamesFound: found,
    requiredReleaseAssetNamesMissing: requiredReleaseAssetNames.filter(
      (name) => !found.includes(name),
    ),
  };
}

function validationVerifiedSummary(input: {
  checksValue: unknown;
  requiredValue: unknown;
}): ReleaseReadbackValidationPosture["verified"] {
  const passedChecks = new Set(
    recordArray(input.checksValue)
      .filter((check) => check.status === "pass" || check.status === "passed")
      .map((check) => stringValue(check.name))
      .filter((name): name is string => name !== undefined),
  );
  const required = recordValue(input.requiredValue);
  const images = stringArray(required.images);
  const charts = recordArray(required.charts);
  const assets = recordArray(required.assets);
  return {
    credentialedNpmRegistry: passedChecks.has(
      "credentialed npm registry readback",
    ),
    images: images.filter((image) =>
      passedChecks.has(`${image} image registry readback is verified`),
    ).length,
    charts: charts.filter((chart) => {
      const name = stringValue(chart.name);
      return (
        name !== undefined &&
        passedChecks.has(`${name} chart repository readback is verified`)
      );
    }).length,
    releaseAssets: assets.filter((asset) => {
      const name = releaseValidationAssetName(asset);
      return (
        name !== undefined &&
        passedChecks.has(`${name} release asset readback is verified`)
      );
    }).length,
  };
}

function validationCheckSummary(
  checksValue: unknown,
): ReleaseReadbackValidationPosture["checks"] {
  const checks = recordArray(checksValue);
  return {
    total: checks.length,
    passed: checks.filter(
      (check) => check.status === "pass" || check.status === "passed",
    ).length,
    failed: checks.filter(
      (check) => check.status === "fail" || check.status === "failed",
    ).length,
  };
}

function validationRedactionProof(
  redactionValue: unknown,
): ReleaseReadbackValidationPosture["redactionProof"] {
  const redaction = recordValue(redactionValue);
  const safeFlagCount = validationRedactionFlags.filter(
    (flag) => redaction[flag] === false,
  ).length;
  const unsafeFlagCount = validationRedactionFlags.filter(
    (flag) => redaction[flag] === true,
  ).length;
  const missingFlagCount = validationRedactionFlags.length - safeFlagCount;
  return {
    status:
      safeFlagCount === validationRedactionFlags.length ? "passed" : "failed",
    requiredFlagCount: validationRedactionFlags.length,
    safeFlagCount,
    unsafeFlagCount,
    missingFlagCount,
  };
}

function releaseReadbackWarnings(input: {
  plan: ReleaseReadbackPlanPosture;
  readback: ReleaseReadbackEvidencePosture;
  validation: ReleaseReadbackValidationPosture;
}): ReleaseReadbackPostureWarning[] {
  const warnings = new Set<ReleaseReadbackPostureWarning>();
  if (input.plan.status === "not_configured") {
    warnings.add("release_readback_plan_not_configured");
  } else if (input.plan.status === "invalid") {
    warnings.add("release_readback_plan_invalid");
  } else if (input.plan.status === "blocked") {
    warnings.add("release_readback_plan_blocked");
  }
  if (input.readback.status === "not_configured") {
    warnings.add("release_readback_evidence_not_configured");
  } else if (input.readback.status === "invalid") {
    warnings.add("release_readback_evidence_invalid");
  } else {
    if (input.readback.mode !== "live_registry_readback") {
      warnings.add("release_readback_evidence_not_live");
    }
    if (input.readback.evidenceStatus !== "collected") {
      warnings.add("release_readback_evidence_not_collected");
    }
  }
  if (input.validation.status === "not_configured") {
    warnings.add("release_readback_validation_not_configured");
  } else if (input.validation.status === "invalid") {
    warnings.add("release_readback_validation_invalid");
  } else {
    if (input.validation.mode !== "live_readback") {
      warnings.add("release_readback_validation_not_live");
    }
    if (
      input.validation.validationStatus !== "pass" ||
      input.validation.status === "failed"
    ) {
      warnings.add("release_readback_validation_failed");
    }
    if (input.validation.redactionProof.status !== "passed") {
      warnings.add("release_readback_validation_redaction_missing");
    }
  }
  if (
    input.validation.required.packages < 1 ||
    input.validation.required.images < 1 ||
    input.validation.required.charts < 1 ||
    input.validation.required.requiredReleaseAssetNamesMissing.length > 0
  ) {
    warnings.add("release_readback_required_artifacts_missing");
  }
  return [...warnings];
}

function releaseReadbackRedaction(): ReleaseReadbackPostureReport["redaction"] {
  return {
    evidenceFileBodiesReturned: false,
    helmRepositoryUrlsReturned: false,
    ociImageRefsReturned: false,
    packageRegistryUrlsReturned: false,
    packageTarballsReturned: false,
    rawEvidencePathsReturned: false,
    rawHelmRepositoryBodiesReturned: false,
    rawOciManifestsReturned: false,
    rawReadbackBodiesReturned: false,
    rawRegistryResponsesReturned: false,
    releaseAssetUrlsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function registryCredentialSummary(
  value: unknown,
): ReleaseReadbackEvidencePosture["registries"] {
  const registries = recordValue(value);
  return {
    npmCredentialsUsed: credentialsUsed(registries.npm),
    ociCredentialsUsed: credentialsUsed(registries.oci),
    helmCredentialsUsed: credentialsUsed(registries.helm),
    assetCredentialsUsed: credentialsUsed(registries.releaseAssets),
  };
}

function credentialsUsed(value: unknown): boolean {
  return recordValue(recordValue(value).auth).credentialsUsed === true;
}

function releaseSummary(
  value: unknown,
): ReleaseReadbackEvidencePosture["release"] | undefined {
  const release = recordValue(value);
  const name = stringValue(release.name);
  const version = stringValue(release.version);
  if (name === undefined && version === undefined) return undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version }),
  };
}

function readbackMode(
  value: unknown,
): "dry-run" | "live_registry_readback" | "unknown" {
  if (value === "dry-run" || value === "live_registry_readback") {
    return value;
  }
  return "unknown";
}

function readbackEvidenceStatus(
  value: unknown,
): "collected" | "planned" | "unknown" {
  if (value === "collected" || value === "planned") return value;
  return "unknown";
}

function validationMode(
  value: unknown,
): "live_readback" | "planned_readback" | "unknown" {
  if (value === "live_readback" || value === "planned_readback") {
    return value;
  }
  return "unknown";
}

function validationStatusValue(value: unknown): "fail" | "pass" | "unknown" {
  if (value === "fail" || value === "pass") return value;
  return "unknown";
}

function releasePlanReadbackIdentity(
  value: string,
  kind: "chart" | "image",
): string | undefined {
  const digestIndex = value.lastIndexOf("@sha256:");
  if (digestIndex <= 0) return undefined;
  const identity = value.slice(0, digestIndex);
  if (kind === "image" && identity.endsWith(":latest")) return undefined;
  return identity.length > 0 ? identity : undefined;
}

function releasePlanAsset(
  value: string | undefined,
): { name: string; sha256: string } | undefined {
  if (value === undefined) return undefined;
  const digestIndex = value.lastIndexOf("@sha256:");
  if (digestIndex <= 0) return undefined;
  const assignment = value.slice(0, digestIndex);
  const separator = assignment.indexOf("=");
  const name = separator > 0 ? assignment.slice(0, separator) : undefined;
  const sha256 = value.slice(digestIndex + "@sha256:".length);
  if (name === undefined || !sha256Hex(sha256)) return undefined;
  return { name, sha256 };
}

function releasePlanRequiredAsset(
  value: string | undefined,
): { name: string; sha256: string } | undefined {
  if (value === undefined) return undefined;
  const digestIndex = value.lastIndexOf("@sha256:");
  if (digestIndex <= 0) return undefined;
  const name = value.slice(0, digestIndex);
  const sha256 = value.slice(digestIndex + "@sha256:".length);
  if (name.length === 0 || !sha256Hex(sha256)) return undefined;
  return { name, sha256 };
}

function releaseValidationAssetName(
  asset: Record<string, unknown>,
): string | undefined {
  const name = stringValue(asset.name);
  return name === undefined || name.length > 120 ? undefined : name;
}

function sha256Pinned(value: string): boolean {
  const digestIndex = value.lastIndexOf("@sha256:");
  if (digestIndex <= 0) return false;
  return sha256Hex(value.slice(digestIndex + "@sha256:".length));
}

function sha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
