import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  argValue,
  argValues,
  fileEvidence,
  hasFlag,
  nonEmptyString,
  readJson,
  repoPath,
  root,
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
const outputPath = repoPath(
  argValue("--output") ?? "dist/release/release-readback.json",
);
const readbackPlanPath =
  argValue("--readback-plan-file") === undefined
    ? undefined
    : repoPath(argValue("--readback-plan-file"));
const readbackPlan =
  readbackPlanPath === undefined
    ? undefined
    : readReleaseReadbackPlan(readbackPlanPath);
const registryUrl =
  argValue("--npm-registry-url") ?? "https://registry.npmjs.org/";
const tokenEnv = argValue("--npm-token-env") ?? "NPM_TOKEN";
const token = process.env[tokenEnv] ?? process.env.NODE_AUTH_TOKEN;
const ociTokenEnv = argValue("--oci-token-env") ?? "OCI_REGISTRY_TOKEN";
const ociToken = process.env[ociTokenEnv];
const helmRepositoryUrl =
  argValue("--helm-repository-url") ?? readbackPlan?.helmRepositoryUrl;
const helmTokenEnv = argValue("--helm-token-env") ?? "HELM_REPOSITORY_TOKEN";
const helmToken = process.env[helmTokenEnv];
const assetTokenEnv = argValue("--asset-token-env") ?? "RELEASE_ASSET_TOKEN";
const assetToken = process.env[assetTokenEnv];
const timeoutMs = positiveInteger(
  argValue("--timeout-ms") ?? "30000",
  "--timeout-ms",
);
const maxTarballBytes = positiveInteger(
  argValue("--max-tarball-bytes") ?? String(100 * 1024 * 1024),
  "--max-tarball-bytes",
);
const maxManifestBytes = positiveInteger(
  argValue("--max-manifest-bytes") ?? String(5 * 1024 * 1024),
  "--max-manifest-bytes",
);
const maxChartBytes = positiveInteger(
  argValue("--max-chart-bytes") ?? String(100 * 1024 * 1024),
  "--max-chart-bytes",
);
const maxAssetBytes = positiveInteger(
  argValue("--max-asset-bytes") ?? String(25 * 1024 * 1024),
  "--max-asset-bytes",
);
const generatedAt = argValue("--generated-at") ?? new Date().toISOString();
const dryRun = hasFlag("--dry-run");
const stdout = hasFlag("--stdout");
const allowInsecureRegistry = hasFlag("--allow-insecure-registry");
const allowInsecureHelmRepository = hasFlag("--allow-insecure-helm-repository");
const allowInsecureReleaseAssets = hasFlag("--allow-insecure-release-assets");

const manifest = readJson(manifestPath);
const imageReadbacks = [
  ...(readbackPlan?.images.map((item) => item.readback) ?? []),
  ...argValues("--image-readback"),
].map(parseImageReadback);
const chartReadbacks = [
  ...(readbackPlan?.charts.map((item) => item.readback) ?? []),
  ...argValues("--chart-readback"),
].map(parseChartReadback);
const assetReadbacks = [
  ...(readbackPlan?.assets.map((item) => item.readback) ?? []),
  ...argValues("--asset-readback"),
].map(parseAssetReadback);

const readback = dryRun ? plannedReadback() : await liveReadback();
writeJsonOrStdout(outputPath, removeUndefinedDeep(readback), stdout);
if (!stdout)
  console.log(`Wrote Romeo release readback to ${relative(root, outputPath)}`);

function plannedReadback() {
  return {
    schemaVersion: "romeo.release-readback.v1",
    generatedAt,
    mode: "dry-run",
    status: "planned",
    release: releaseSummary(),
    registries: registrySummary({
      npmCredentialsUsed: false,
      ociCredentialsUsed: false,
      helmCredentialsUsed: false,
      assetCredentialsUsed: false,
    }),
    packages: manifest.artifacts.map((artifact) => ({
      name: artifact.name,
      version: artifact.version,
      expectedSha256: artifact.sha256,
      source: "npm_registry",
      status: "planned",
    })),
    channel: fileEvidence(channelPath, relative(root, channelPath)),
    securityEvidence: fileEvidence(
      securityEvidencePath,
      relative(root, securityEvidencePath),
    ),
    sbom: fileEvidence(sbomPath, relative(root, sbomPath)),
    images: imageReadbacks,
    helmCharts: chartReadbacks,
    assets: assetReadbacks.map(plannedAssetReadback),
  };
}

async function liveReadback() {
  if (token === undefined || token.length === 0) {
    throw new Error(
      `${tokenEnv} or NODE_AUTH_TOKEN is required for credentialed release readback collection.`,
    );
  }

  const packages = [];
  for (const artifact of manifest.artifacts) {
    packages.push(await collectPackageReadback(artifact));
  }
  const images = await collectImageReadbacks();
  const helmCharts = await collectChartReadbacks();
  const assets = await collectAssetReadbacks();

  return {
    schemaVersion: "romeo.release-readback.v1",
    generatedAt,
    mode: "live_registry_readback",
    status: "collected",
    release: releaseSummary(),
    registries: registrySummary({
      npmCredentialsUsed: true,
      ociCredentialsUsed: images.some((image) => image.auth?.credentialsUsed),
      helmCredentialsUsed: helmCharts.some(
        (chart) => chart.auth?.credentialsUsed,
      ),
      assetCredentialsUsed: assets.some((asset) => asset.auth?.credentialsUsed),
    }),
    packages,
    channel: fileEvidence(channelPath, relative(root, channelPath)),
    securityEvidence: fileEvidence(
      securityEvidencePath,
      relative(root, securityEvidencePath),
    ),
    sbom: fileEvidence(sbomPath, relative(root, sbomPath)),
    images,
    helmCharts,
    assets,
  };
}

async function collectPackageReadback(artifact) {
  const name = nonEmptyString(artifact.name, "artifact name");
  const version = nonEmptyString(artifact.version, `${name} artifact version`);
  const metadata = await fetchJson(packageMetadataUrl(name));
  const versionMetadata = metadata.versions?.[version];
  if (versionMetadata === undefined) {
    throw new Error(`${name}@${version} was not found in registry metadata.`);
  }
  const tarballUrl = nonEmptyString(
    versionMetadata.dist?.tarball,
    `${name}@${version} tarball URL`,
  );
  const tarball = await fetchBytes(tarballUrl, {
    headers: bearerHeaders(token, { accept: "application/octet-stream" }),
    maxBytes: maxTarballBytes,
    label: "package tarball",
  });
  const sha256 = sha256Buffer(tarball);
  return {
    name,
    version,
    source: "npm_registry",
    registry: safeRegistry(registryUrl),
    tarballOrigin: new URL(tarballUrl).origin,
    bytes: tarball.length,
    sha256,
    tarballSha256: sha256,
    expectedSha256: artifact.sha256,
    distTagLatest: metadata["dist-tags"]?.latest,
    integrityAlgorithm: integrityAlgorithm(versionMetadata.dist?.integrity),
  };
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: bearerHeaders(token, { accept: "application/json" }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${safeUrl(url)} returned HTTP ${response.status}.`);
  }
  return JSON.parse(text);
}

async function collectImageReadbacks() {
  const collected = [];
  for (const item of imageReadbacks) {
    collected.push(await collectImageReadback(item));
  }
  return collected;
}

async function collectImageReadback(item) {
  const reference = parseOciImageReference(item.image, item.digest);
  const url = ociManifestUrl(reference);
  const response = await fetchBytesWithHeaders(url, {
    headers: bearerHeaders(ociToken, {
      accept: [
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
      ].join(", "),
    }),
    maxBytes: maxManifestBytes,
    label: "OCI manifest",
  });
  const manifestSha256 = sha256Buffer(response.buffer);
  const computedDigest = `sha256:${manifestSha256}`;
  const headerDigest = normalizeDigest(
    response.headers.get("docker-content-digest"),
  );
  if (headerDigest !== undefined && headerDigest !== reference.digest) {
    throw new Error(
      `${reference.image} returned digest ${headerDigest}, expected ${reference.digest}.`,
    );
  }
  if (computedDigest !== reference.digest) {
    throw new Error(
      `${reference.image} manifest digest ${computedDigest} did not match expected ${reference.digest}.`,
    );
  }
  return {
    image: reference.image,
    source: "oci_registry",
    registry: safeRegistryOrigin(reference.scheme, reference.registry),
    repository: reference.repository,
    tag: reference.tag,
    digest: reference.digest,
    observedDigest: headerDigest ?? computedDigest,
    manifestSha256,
    mediaType: response.contentType,
    bytes: response.buffer.length,
    auth: {
      tokenEnv: ociTokenEnv,
      tokenConfigured: ociToken !== undefined && ociToken.length > 0,
      credentialsUsed: ociToken !== undefined && ociToken.length > 0,
    },
  };
}

async function collectChartReadbacks() {
  if (chartReadbacks.length === 0) return [];
  if (helmRepositoryUrl === undefined) {
    return chartReadbacks.map((item) => ({
      ...item,
      source: "declared",
      status: "declared_without_repository_readback",
    }));
  }
  const indexUrl = helmIndexUrl();
  const response = await fetchTextWithHeaders(indexUrl, {
    headers: bearerHeaders(helmToken, {
      accept: "application/x-yaml, text/yaml, text/plain",
    }),
    maxBytes: maxManifestBytes,
    label: "Helm repository index",
  });
  const index = parseYaml(response.text);
  const collected = [];
  for (const item of chartReadbacks) {
    collected.push(await collectChartReadback(item, index));
  }
  return collected;
}

async function collectAssetReadbacks() {
  const collected = [];
  for (const item of assetReadbacks) {
    collected.push(await collectAssetReadback(item));
  }
  return collected;
}

async function collectAssetReadback(item) {
  const response = await fetchBytesWithHeaders(item.url, {
    headers: bearerHeaders(assetToken, {
      accept: "application/json, application/octet-stream, */*",
    }),
    maxBytes: maxAssetBytes,
    label: `release asset ${item.name}`,
  });
  const sha256 = sha256Buffer(response.buffer);
  if (sha256 !== item.expectedSha256) {
    throw new Error(
      `${item.name} release asset digest sha256:${sha256} did not match expected sha256:${item.expectedSha256}.`,
    );
  }
  return {
    name: item.name,
    source: "release_asset",
    ...safeReleaseAsset(item.url),
    digest: `sha256:${sha256}`,
    sha256,
    expectedSha256: item.expectedSha256,
    bytes: response.buffer.length,
    mediaType: response.contentType,
    auth: {
      tokenEnv: assetTokenEnv,
      tokenConfigured: assetToken !== undefined && assetToken.length > 0,
      credentialsUsed: assetToken !== undefined && assetToken.length > 0,
    },
  };
}

function plannedAssetReadback(item) {
  return {
    name: item.name,
    source: "release_asset",
    status: "planned",
    ...safeReleaseAsset(item.url),
    digest: `sha256:${item.expectedSha256}`,
    expectedSha256: item.expectedSha256,
    auth: {
      tokenEnv: assetTokenEnv,
      tokenConfigured: assetToken !== undefined && assetToken.length > 0,
      credentialsUsed: false,
    },
  };
}

async function collectChartReadback(item, index) {
  const entries = Array.isArray(index?.entries?.[item.name])
    ? index.entries[item.name]
    : [];
  const entry = entries.find(
    (candidate) => candidate?.version === item.version,
  );
  if (entry === undefined) {
    throw new Error(
      `${item.name}:${item.version} was not found in Helm index.`,
    );
  }
  const chartUrl = helmChartUrl(entry);
  const response = await fetchBytesWithHeaders(chartUrl, {
    headers: bearerHeaders(helmToken, {
      accept: "application/gzip, application/octet-stream",
    }),
    maxBytes: maxChartBytes,
    label: "Helm chart package",
  });
  const chartSha256 = sha256Buffer(response.buffer);
  const computedDigest = `sha256:${chartSha256}`;
  const indexDigest = normalizeDigest(entry.digest);
  const expectedDigest = item.digest ?? indexDigest ?? computedDigest;
  if (expectedDigest !== computedDigest) {
    throw new Error(
      `${item.name}:${item.version} chart digest ${computedDigest} did not match expected ${expectedDigest}.`,
    );
  }
  return {
    name: item.name,
    version: item.version,
    source: "helm_repository",
    repository: safeHelmRepository(helmRepositoryUrl),
    chartOrigin: chartUrl.origin,
    digest: expectedDigest,
    chartSha256,
    indexDigest,
    appVersion:
      typeof entry.appVersion === "string" ? entry.appVersion : undefined,
    urlsCount: Array.isArray(entry.urls) ? entry.urls.length : 0,
    bytes: response.buffer.length,
    mediaType: response.contentType,
    auth: {
      tokenEnv: helmTokenEnv,
      tokenConfigured: helmToken !== undefined && helmToken.length > 0,
      credentialsUsed: helmToken !== undefined && helmToken.length > 0,
    },
  };
}

async function fetchBytes(url, options) {
  return (await fetchBytesWithHeaders(url, options)).buffer;
}

async function fetchBytesWithHeaders(url, { headers, maxBytes, label }) {
  const response = await fetchWithTimeout(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`${safeUrl(url)} returned HTTP ${response.status}.`);
  }
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error(`${safeUrl(url)} had no body.`);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(
        `${safeUrl(url)} exceeded ${label} byte limit (${maxBytes}).`,
      );
    }
    chunks.push(chunk);
  }
  return {
    buffer: Buffer.concat(chunks, total),
    headers: response.headers,
    contentType: response.headers.get("content-type") ?? undefined,
  };
}

async function fetchTextWithHeaders(url, { headers, maxBytes, label }) {
  const response = await fetchBytesWithHeaders(url, {
    headers,
    maxBytes,
    label,
  });
  return {
    text: response.buffer.toString("utf8"),
    headers: response.headers,
    contentType: response.contentType,
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function bearerHeaders(value, headers) {
  if (value === undefined || value.length === 0) return headers;
  return { ...headers, authorization: `Bearer ${value}` };
}

function packageMetadataUrl(name) {
  return new URL(
    encodeURIComponent(name).replaceAll("%2F", "%2f"),
    normalizedRegistryUrl(registryUrl),
  );
}

function normalizedRegistryUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function safeRegistry(value) {
  const url = new URL(normalizedRegistryUrl(value));
  return {
    origin: url.origin,
    pathConfigured: url.pathname !== "/",
  };
}

function safeRegistryOrigin(scheme, registry) {
  return {
    origin: `${scheme}://${registry}`,
    insecure: scheme === "http",
  };
}

function safeHelmRepository(value) {
  const url = new URL(normalizedHelmRepositoryUrl(value));
  return {
    origin: url.origin,
    pathConfigured: url.pathname !== "/",
    insecure: url.protocol === "http:",
  };
}

function safeUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function releaseSummary() {
  return {
    name: nonEmptyString(manifest.name, "release manifest name"),
    version: nonEmptyString(manifest.version, "release manifest version"),
  };
}

function registrySummary(input) {
  return {
    npm: {
      ...safeRegistry(registryUrl),
      auth: {
        tokenEnv,
        tokenConfigured: token !== undefined && token.length > 0,
        credentialsUsed: input.npmCredentialsUsed,
      },
      packageCount: manifest.artifacts.length,
    },
    oci: {
      auth: {
        tokenEnv: ociTokenEnv,
        tokenConfigured: ociToken !== undefined && ociToken.length > 0,
        credentialsUsed: input.ociCredentialsUsed,
      },
      imageCount: imageReadbacks.length,
      insecureAllowed: allowInsecureRegistry,
    },
    helm: {
      repository:
        helmRepositoryUrl === undefined
          ? undefined
          : safeHelmRepository(helmRepositoryUrl),
      auth: {
        tokenEnv: helmTokenEnv,
        tokenConfigured: helmToken !== undefined && helmToken.length > 0,
        credentialsUsed: input.helmCredentialsUsed,
      },
      chartCount: chartReadbacks.length,
      insecureAllowed: allowInsecureHelmRepository,
    },
    releaseAssets: {
      auth: {
        tokenEnv: assetTokenEnv,
        tokenConfigured: assetToken !== undefined && assetToken.length > 0,
        credentialsUsed: input.assetCredentialsUsed,
      },
      assetCount: assetReadbacks.length,
      insecureAllowed: allowInsecureReleaseAssets,
    },
  };
}

function parseImageReadback(value) {
  const [image, digest] = nonEmptyString(value, "--image-readback").split("@");
  if (image === undefined || digest === undefined || image.length === 0) {
    throw new Error("--image-readback must use image:tag@sha256:<digest>.");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      "--image-readback digest must be sha256:<64 lowercase hex>.",
    );
  }
  return { image, digest };
}

function parseChartReadback(value) {
  const [identity, digest] = nonEmptyString(value, "--chart-readback").split(
    "@",
  );
  const [name, version] = identity.split(":");
  if (
    name === undefined ||
    version === undefined ||
    name.length === 0 ||
    version.length === 0
  ) {
    throw new Error(
      "--chart-readback must use name:version[@sha256:<digest>].",
    );
  }
  if (digest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      "--chart-readback digest must be sha256:<64 lowercase hex>.",
    );
  }
  return { name, version, digest };
}

function parseAssetReadback(value) {
  const input = nonEmptyString(value, "--asset-readback");
  const digestIndex = input.lastIndexOf("@sha256:");
  if (digestIndex <= 0) {
    throw new Error(
      "--asset-readback must use name=https://host/path@sha256:<digest>.",
    );
  }
  const assignment = input.slice(0, digestIndex);
  const digest = input.slice(digestIndex + 1);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(
      "--asset-readback digest must be sha256:<64 lowercase hex>.",
    );
  }
  const separator = assignment.indexOf("=");
  if (separator <= 0 || separator === assignment.length - 1) {
    throw new Error(
      "--asset-readback must use name=https://host/path@sha256:<digest>.",
    );
  }
  const name = assignment.slice(0, separator);
  const url = new URL(assignment.slice(separator + 1));
  validateAssetName(name, "--asset-readback name");
  assertSafeReleaseAssetUrl(url);
  return { name, url, expectedSha256: digest.slice("sha256:".length) };
}

function parseOciImageReference(image, digest) {
  const slash = image.indexOf("/");
  if (slash <= 0) {
    throw new Error(
      "--image-readback must include an explicit registry, repository, and tag.",
    );
  }
  const registry = image.slice(0, slash);
  const remainder = image.slice(slash + 1);
  const tagSeparator = remainder.lastIndexOf(":");
  if (
    tagSeparator <= 0 ||
    tagSeparator === remainder.length - 1 ||
    remainder.includes("@")
  ) {
    throw new Error(
      "--image-readback must use registry/repository:tag@sha256:<digest>.",
    );
  }
  const repository = remainder.slice(0, tagSeparator);
  const tag = remainder.slice(tagSeparator + 1);
  if (repository.split("/").some((segment) => segment.length === 0)) {
    throw new Error("--image-readback repository path is invalid.");
  }
  const hostname = registry.split(":")[0];
  const scheme =
    allowInsecureRegistry || isLocalRegistry(hostname) ? "http" : "https";
  return {
    image,
    registry,
    repository,
    tag,
    digest,
    scheme,
  };
}

function ociManifestUrl(reference) {
  const repositoryPath = reference.repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(
    `${reference.scheme}://${reference.registry}/v2/${repositoryPath}/manifests/${encodeURIComponent(reference.tag)}`,
  );
}

function helmIndexUrl() {
  const url = new URL(
    "index.yaml",
    normalizedHelmRepositoryUrl(helmRepositoryUrl),
  );
  assertSafeHelmUrl(url);
  return url;
}

function helmChartUrl(entry) {
  const firstUrl = Array.isArray(entry.urls) ? entry.urls[0] : undefined;
  if (typeof firstUrl !== "string" || firstUrl.length === 0) {
    throw new Error("Helm chart index entry must contain at least one URL.");
  }
  const url = new URL(firstUrl, normalizedHelmRepositoryUrl(helmRepositoryUrl));
  assertSafeHelmUrl(url);
  return url;
}

function normalizedHelmRepositoryUrl(value) {
  const url = nonEmptyString(value, "--helm-repository-url");
  return url.endsWith("/") ? url : `${url}/`;
}

function assertSafeHelmUrl(url) {
  if (url.protocol === "https:") return;
  if (
    url.protocol === "http:" &&
    (allowInsecureHelmRepository || isLocalRegistry(url.hostname))
  ) {
    return;
  }
  throw new Error(
    "Helm repository readback requires HTTPS unless --allow-insecure-helm-repository or localhost is used.",
  );
}

function assertSafeReleaseAssetUrl(url) {
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(
      "Release asset readback URLs must not embed username or password credentials.",
    );
  }
  if (url.protocol === "https:") return;
  if (
    url.protocol === "http:" &&
    (allowInsecureReleaseAssets || isLocalRegistry(url.hostname))
  ) {
    return;
  }
  throw new Error(
    "Release asset readback requires HTTPS unless --allow-insecure-release-assets or localhost is used.",
  );
}

function safeReleaseAsset(url) {
  return {
    origin: url.origin,
    path: url.pathname,
    insecure: url.protocol === "http:",
  };
}

function validateAssetName(value, label) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,80}$/u.test(value)) {
    throw new Error(
      `${label} must start with a lowercase letter or number and contain only lowercase letters, numbers, dot, underscore, colon, or hyphen.`,
    );
  }
}

function normalizeDigest(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.startsWith("sha256:") ? value : `sha256:${value}`;
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) return undefined;
  return normalized;
}

function isLocalRegistry(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function integrityAlgorithm(value) {
  if (typeof value !== "string") return undefined;
  const index = value.indexOf("-");
  return index > 0 ? value.slice(0, index) : undefined;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function writeJsonOrStdout(path, value, useStdout) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (useStdout) {
    process.stdout.write(body);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
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
