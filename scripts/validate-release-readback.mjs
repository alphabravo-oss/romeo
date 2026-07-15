import { relative } from "node:path";

import {
  argValue,
  argValues,
  fileEvidence,
  hasFlag,
  nonEmptyString,
  readJson,
  repoPath,
  root,
  validateSha256,
  writeJsonOrStdout,
} from "./lib/release-artifacts.mjs";
import { readReleaseReadbackPlan } from "./lib/release-readback-plan.mjs";

const manifestPath = repoPath(
  argValue("--manifest") ?? "dist/release/release-manifest.json",
);
const channelPath = repoPath(
  argValue("--channel-file") ?? "dist/release/release-channel.json",
);
const securityEvidencePath = repoPath(
  argValue("--security-evidence") ?? "dist/release/security-evidence.json",
);
const sbomPath = repoPath(argValue("--sbom") ?? "dist/release/sbom.cdx.json");
const readbackPathValue = argValue("--readback-file");
const readbackPlanPathValue = argValue("--readback-plan-file");
const readbackPlan =
  readbackPlanPathValue === undefined
    ? undefined
    : readReleaseReadbackPlan(repoPath(readbackPlanPathValue));
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/readback-validation.json",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const plannedReadback = hasFlag("--planned-readback");
const requireSbom = hasFlag("--require-sbom") || plannedReadback;
const requireSecurityEvidence =
  hasFlag("--require-security-evidence") || plannedReadback;
const requireChannel = hasFlag("--require-channel") || plannedReadback;
const requiredImages = [
  ...(readbackPlan?.images.map((item) => item.required) ?? []),
  ...argValues("--require-image"),
].map((image) => nonEmptyString(image, "--require-image"));
const requiredCharts = [
  ...(readbackPlan?.charts.map((item) => item.required) ?? []),
  ...argValues("--require-chart"),
].map(parseRequiredChart);
const requiredAssets = [
  ...(readbackPlan?.assets.map((item) => item.required) ?? []),
  ...argValues("--require-asset"),
].map(parseRequiredAsset);
const stdout = hasFlag("--stdout");

if (!plannedReadback && readbackPathValue === undefined) {
  throw new Error(
    "--readback-file is required unless --planned-readback is supplied.",
  );
}

const manifest = readJson(manifestPath);
const readback = plannedReadback
  ? buildPlannedReadback()
  : readJson(repoPath(readbackPathValue));
const checks = [];
const validation = {
  schemaVersion: "romeo.release-readback-validation.v1",
  generatedAt,
  mode: plannedReadback ? "planned_readback" : "live_readback",
  status: "pass",
  release: {
    name: nonEmptyString(manifest.name, "release manifest name"),
    version: nonEmptyString(manifest.version, "release manifest version"),
    manifest: fileEvidence(manifestPath, relative(root, manifestPath)),
    readbackFile: plannedReadback
      ? undefined
      : relative(root, repoPath(readbackPathValue)),
  },
  required: {
    packages: manifest.artifacts.map((artifact) => ({
      name: artifact.name,
      version: artifact.version,
      sha256: artifact.sha256,
    })),
    sbom: requireSbom,
    securityEvidence: requireSecurityEvidence,
    channel: requireChannel,
    images: requiredImages,
    charts: requiredCharts,
    assets: requiredAssets,
  },
  checks,
  redaction: {
    tokenValuesReturned: false,
    rawReadbackBodyReturned: false,
    rawRegistryResponsesReturned: false,
    rawPackageTarballsReturned: false,
    rawOciManifestsReturned: false,
    rawHelmRepositoryBodiesReturned: false,
    rawReleaseAssetBodiesReturned: false,
    environmentReturned: false,
  },
};

validateReadback();
if (checks.some((check) => check.status === "fail")) validation.status = "fail";

writeJsonOrStdout({
  path: outputPath,
  value: removeUndefinedDeep(validation),
  stdout,
});
if (!stdout)
  console.log(
    `Wrote Romeo release readback validation to ${relative(root, outputPath)}`,
  );
if (validation.status === "fail") process.exit(1);

function buildPlannedReadback() {
  return {
    schemaVersion: "romeo.release-readback.v1",
    generatedAt,
    release: {
      name: manifest.name,
      version: manifest.version,
    },
    packages: manifest.artifacts.map((artifact) => ({
      name: artifact.name,
      version: artifact.version,
      sha256: artifact.sha256,
    })),
    channel: fileEvidence(channelPath, relative(root, channelPath)),
    securityEvidence: fileEvidence(
      securityEvidencePath,
      relative(root, securityEvidencePath),
    ),
    sbom: fileEvidence(sbomPath, relative(root, sbomPath)),
    images: [],
    helmCharts: [],
    assets: [],
  };
}

function validateReadback() {
  check(
    "readback schema",
    readback.schemaVersion === "romeo.release-readback.v1",
  );
  validateCredentialedLiveReadback();
  check(
    "release version matches manifest",
    readback.release?.version === manifest.version,
  );
  validatePackageReadbacks();
  validateOptionalArtifact(
    "release channel",
    readback.channel,
    channelPath,
    requireChannel,
  );
  validateOptionalArtifact(
    "security evidence",
    readback.securityEvidence,
    securityEvidencePath,
    requireSecurityEvidence,
  );
  validateOptionalArtifact("SBOM", readback.sbom, sbomPath, requireSbom);
  validateImageReadbacks();
  validateChartReadbacks();
  validateAssetReadbacks();
}

function validateCredentialedLiveReadback() {
  if (plannedReadback) return;
  const npmAuth = readback.registries?.npm?.auth;
  check(
    "credentialed npm registry readback",
    npmAuth?.credentialsUsed === true && npmAuth?.tokenConfigured === true,
  );
}

function validatePackageReadbacks() {
  const readbacks = new Map();
  for (const item of arrayValue(readback.packages)) {
    const name = item?.name;
    const version = item?.version;
    if (typeof name === "string" && typeof version === "string")
      readbacks.set(`${name}@${version}`, item);
  }

  for (const artifact of manifest.artifacts) {
    const key = `${artifact.name}@${artifact.version}`;
    const item = readbacks.get(key);
    check(`${key} package readback exists`, item !== undefined);
    if (item === undefined) continue;
    const sha256 = item.sha256 ?? item.tarballSha256 ?? item.artifactSha256;
    try {
      check(
        `${key} package sha256 matches manifest`,
        validateSha256(sha256, `${key} readback sha256`) === artifact.sha256,
      );
    } catch (error) {
      check(`${key} package sha256 matches manifest`, false, error.message);
    }
  }
}

function validateOptionalArtifact(label, item, path, required) {
  if (item === undefined) {
    check(`${label} readback exists`, !required);
    return;
  }
  const expected = fileEvidence(path, relative(root, path));
  try {
    check(
      `${label} sha256 matches`,
      validateSha256(item.sha256, `${label} sha256`) === expected.sha256,
    );
  } catch (error) {
    check(`${label} sha256 matches`, false, error.message);
  }
}

function validateImageReadbacks() {
  const images = arrayValue(readback.images);
  for (const image of images) {
    const label = typeof image?.image === "string" ? image.image : "image";
    check(
      `${label} image reference is immutable`,
      typeof image?.digest === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(image.digest),
    );
    if (image?.source === "oci_registry") {
      check(
        `${label} image registry source is verified`,
        typeof image?.observedDigest === "string" &&
          image.observedDigest === image.digest &&
          typeof image?.manifestSha256 === "string" &&
          `sha256:${image.manifestSha256}` === image.digest,
      );
    }
    check(
      `${label} image tag is not latest`,
      typeof image?.image !== "string" || !image.image.endsWith(":latest"),
    );
  }
  for (const required of requiredImages) {
    const item = images.find((image) => image?.image === required);
    check(`${required} image readback exists`, item !== undefined);
    check(
      `${required} image registry readback is verified`,
      item?.source === "oci_registry" &&
        item?.observedDigest === item?.digest &&
        `sha256:${item?.manifestSha256}` === item?.digest,
    );
  }
}

function validateChartReadbacks() {
  const charts = arrayValue(readback.helmCharts);
  for (const chart of charts) {
    const label = typeof chart?.name === "string" ? chart.name : "chart";
    check(
      `${label} chart version exists`,
      typeof chart?.version === "string" && chart.version.length > 0,
    );
    if (chart?.digest !== undefined) {
      check(
        `${label} chart digest is immutable`,
        /^sha256:[a-f0-9]{64}$/u.test(chart.digest),
      );
    }
    if (chart?.source === "helm_repository") {
      check(
        `${label} chart repository source is verified`,
        typeof chart?.chartSha256 === "string" &&
          chart?.digest === `sha256:${chart.chartSha256}`,
      );
    }
  }
  for (const required of requiredCharts) {
    const item = charts.find(
      (chart) =>
        chart?.name === required.name && chart?.version === required.version,
    );
    check(`${required.name} chart readback exists`, item !== undefined);
    check(
      `${required.name} chart repository readback is verified`,
      item?.source === "helm_repository" &&
        typeof item?.digest === "string" &&
        item.digest === `sha256:${item.chartSha256}`,
    );
  }
}

function validateAssetReadbacks() {
  const assets = arrayValue(readback.assets);
  for (const asset of assets) {
    const label =
      typeof asset?.name === "string" ? asset.name : "release asset";
    check(
      `${label} release asset name is valid`,
      isValidAssetName(asset?.name),
    );
    check(
      `${label} release asset source is verified`,
      asset?.source === "release_asset" && asset?.status !== "planned",
    );
    validateAssetDigest(`${label} release asset`, asset);
  }
  for (const required of requiredAssets) {
    const item = assets.find((asset) => asset?.name === required.name);
    check(`${required.name} release asset readback exists`, item !== undefined);
    const sha256 = validateAssetDigest(
      `${required.name} required release asset`,
      item,
      { expectedSha256: required.sha256 },
    );
    check(
      `${required.name} release asset readback is verified`,
      item?.source === "release_asset" &&
        item?.status !== "planned" &&
        typeof sha256 === "string" &&
        (required.sha256 === undefined || sha256 === required.sha256),
    );
  }
}

function parseRequiredChart(value) {
  const [name, version] = nonEmptyString(value, "--require-chart").split(":");
  if (
    name === undefined ||
    version === undefined ||
    name.length === 0 ||
    version.length === 0
  ) {
    throw new Error("--require-chart must use name:version.");
  }
  return { name, version };
}

function parseRequiredAsset(value) {
  const input = nonEmptyString(value, "--require-asset");
  const digestIndex = input.lastIndexOf("@sha256:");
  const name = digestIndex >= 0 ? input.slice(0, digestIndex) : input;
  const digest = digestIndex >= 0 ? input.slice(digestIndex + 1) : undefined;
  if (!isValidAssetName(name)) {
    throw new Error(
      "--require-asset name must start with a lowercase letter or number and contain only lowercase letters, numbers, dot, underscore, colon, or hyphen.",
    );
  }
  if (digest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      "--require-asset digest must be sha256:<64 lowercase hex>.",
    );
  }
  return {
    name,
    sha256: digest === undefined ? undefined : digest.slice("sha256:".length),
  };
}

function validateAssetDigest(label, asset, options = {}) {
  if (asset === undefined) return undefined;
  let sha256;
  try {
    sha256 = validateSha256(asset.sha256, `${label} sha256`);
  } catch (error) {
    check(`${label} sha256 is valid`, false, error.message);
    return undefined;
  }
  check(`${label} sha256 is valid`, true);
  if (asset.digest !== undefined) {
    check(
      `${label} digest matches sha256`,
      asset.digest === `sha256:${sha256}`,
    );
  }
  const expectedSha256 = options.expectedSha256 ?? asset.expectedSha256;
  if (expectedSha256 !== undefined) {
    try {
      check(
        `${label} sha256 matches expected`,
        validateSha256(expectedSha256, `${label} expectedSha256`) === sha256,
      );
    } catch (error) {
      check(`${label} sha256 matches expected`, false, error.message);
    }
  }
  if (asset.bytes !== undefined) {
    check(
      `${label} byte count is bounded metadata`,
      Number.isInteger(asset.bytes) && asset.bytes >= 0,
    );
  }
  return sha256;
}

function isValidAssetName(value) {
  return (
    typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,80}$/u.test(value)
  );
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function check(name, passed, detail) {
  checks.push({
    name,
    status: passed ? "pass" : "fail",
    ...(detail === undefined ? {} : { detail }),
  });
}

function removeUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(removeUndefinedDeep);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefinedDeep(item)]),
  );
}
