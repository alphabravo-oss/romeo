import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import {
  argValue,
  fileEvidence,
  readJson,
  repoPath,
  root,
  writeJson,
} from "./lib/release-artifacts.mjs";

const outputPath = repoPath(
  argValue("--output") ?? "dist/ci/release-readback-smoke.json",
);
const copyReadbackPath =
  argValue("--readback-output") === undefined
    ? undefined
    : repoPath(argValue("--readback-output"));
const copyValidationPath =
  argValue("--validation-output") === undefined
    ? undefined
    : repoPath(argValue("--validation-output"));
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
const provenancePath = repoPath(
  argValue("--provenance-file") ?? "dist/release/release-provenance.json",
);
const approvalPath = repoPath(
  argValue("--approval-file") ?? "dist/release/release-approval.json",
);
const generatedAt = new Date().toISOString();
const manifest = readJson(manifestPath);
const artifactByFile = new Map(
  manifest.artifacts.map((artifact) => [artifact.file, artifact]),
);
const tokens = {
  npm: `npm_${randomBytes(24).toString("hex")}`,
  oci: `oci_${randomBytes(24).toString("hex")}`,
  helm: `helm_${randomBytes(24).toString("hex")}`,
  asset: `asset_${randomBytes(24).toString("hex")}`,
};
const ociManifest = Buffer.from(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: `sha256:${"0".repeat(64)}`,
      size: 2,
    },
    layers: [],
  }),
);
const ociDigest = sha256Buffer(ociManifest);
const chartBytes = Buffer.from("romeo helm chart package fixture\n");
const chartDigest = sha256Buffer(chartBytes);
const releaseAssets = [
  {
    name: "release-channel",
    route: "/assets/release-channel.json",
    path: channelPath,
  },
  {
    name: "security-evidence",
    route: "/assets/security-evidence.json",
    path: securityEvidencePath,
  },
  { name: "sbom", route: "/assets/sbom.cdx.json", path: sbomPath },
  {
    name: "provenance",
    route: "/assets/release-provenance.json",
    path: provenancePath,
  },
  {
    name: "approval",
    route: "/assets/release-approval.json",
    path: approvalPath,
  },
].map((asset) => ({
  ...asset,
  sha256: fileEvidence(asset.path, asset.route.slice(1)).sha256,
}));
const tempDir = join(
  tmpdir(),
  `romeo-release-readback-smoke-${randomBytes(6).toString("hex")}`,
);

mkdirSync(tempDir, { recursive: true });

const server = createServer((request, response) => {
  try {
    handleRequest(request, response);
  } catch {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("error");
  }
});

try {
  await listen(server);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const image = `127.0.0.1:${port}/romeo/app:0.1.0`;
  const readbackPath = join(tempDir, "release-readback.json");
  const validationPath = join(tempDir, "readback-validation.json");
  const readbackPlanPath = join(tempDir, "release-readback-plan.json");
  writeJson(readbackPlanPath, {
    schemaVersion: "romeo.release-readback-plan.v1",
    helm: { repositoryUrl: `${baseUrl}/helm/` },
    images: [
      {
        readback: `${image}@sha256:${ociDigest}`,
        required: image,
      },
    ],
    charts: [
      {
        readback: `romeo:${manifest.version}@sha256:${chartDigest}`,
        required: `romeo:${manifest.version}`,
      },
    ],
    assets: releaseAssets.map((asset) => ({
      readback: `${asset.name}=${baseUrl}${asset.route}@sha256:${asset.sha256}`,
      required: `${asset.name}@sha256:${asset.sha256}`,
    })),
  });

  const positiveCollect = await runNodeScript(
    "scripts/collect-release-readback.mjs",
    [
      "--manifest",
      manifestPath,
      "--channel-file",
      channelPath,
      "--security-evidence",
      securityEvidencePath,
      "--sbom",
      sbomPath,
      "--npm-registry-url",
      baseUrl,
      "--readback-plan-file",
      readbackPlanPath,
      "--output",
      readbackPath,
    ],
    {
      NPM_TOKEN: tokens.npm,
      OCI_REGISTRY_TOKEN: tokens.oci,
      HELM_REPOSITORY_TOKEN: tokens.helm,
      RELEASE_ASSET_TOKEN: tokens.asset,
    },
  );
  const positiveValidate = await runNodeScript(
    "scripts/validate-release-readback.mjs",
    [
      "--manifest",
      manifestPath,
      "--channel-file",
      channelPath,
      "--security-evidence",
      securityEvidencePath,
      "--sbom",
      sbomPath,
      "--readback-file",
      readbackPath,
      "--readback-plan-file",
      readbackPlanPath,
      "--output",
      validationPath,
    ],
  );

  const imageNegativePath = join(tempDir, "declared-image-readback.json");
  const imageNegativeValidationPath = join(
    tempDir,
    "declared-image-validation.json",
  );
  writeJson(imageNegativePath, declaredReadback({ image }));
  const imageNegative = await runNodeScript(
    "scripts/validate-release-readback.mjs",
    [
      "--manifest",
      manifestPath,
      "--channel-file",
      channelPath,
      "--security-evidence",
      securityEvidencePath,
      "--sbom",
      sbomPath,
      "--readback-file",
      imageNegativePath,
      "--require-image",
      image,
      "--output",
      imageNegativeValidationPath,
    ],
    {},
    { expectFailure: true },
  );
  assertFailedCheck(
    imageNegativeValidationPath,
    `${image} image registry readback is verified`,
  );

  const chartNegativePath = join(tempDir, "declared-chart-readback.json");
  const chartNegativeValidationPath = join(
    tempDir,
    "declared-chart-validation.json",
  );
  writeJson(chartNegativePath, declaredReadback({ chart: true }));
  const chartNegative = await runNodeScript(
    "scripts/validate-release-readback.mjs",
    [
      "--manifest",
      manifestPath,
      "--channel-file",
      channelPath,
      "--security-evidence",
      securityEvidencePath,
      "--sbom",
      sbomPath,
      "--readback-file",
      chartNegativePath,
      "--require-chart",
      `romeo:${manifest.version}`,
      "--output",
      chartNegativeValidationPath,
    ],
    {},
    { expectFailure: true },
  );
  assertFailedCheck(
    chartNegativeValidationPath,
    "romeo chart repository readback is verified",
  );

  const assetNegativePath = join(tempDir, "declared-asset-readback.json");
  const assetNegativeValidationPath = join(
    tempDir,
    "declared-asset-validation.json",
  );
  const sbomAsset = releaseAssets.find((asset) => asset.name === "sbom");
  writeJson(assetNegativePath, declaredReadback({ assetName: "sbom" }));
  const assetNegative = await runNodeScript(
    "scripts/validate-release-readback.mjs",
    [
      "--manifest",
      manifestPath,
      "--channel-file",
      channelPath,
      "--security-evidence",
      securityEvidencePath,
      "--sbom",
      sbomPath,
      "--readback-file",
      assetNegativePath,
      "--require-asset",
      `sbom@sha256:${sbomAsset.sha256}`,
      "--output",
      assetNegativeValidationPath,
    ],
    {},
    { expectFailure: true },
  );
  assertFailedCheck(
    assetNegativeValidationPath,
    "sbom release asset readback is verified",
  );

  assertNoTokenLeak([
    readbackPath,
    validationPath,
    imageNegativePath,
    imageNegativeValidationPath,
    chartNegativePath,
    chartNegativeValidationPath,
    assetNegativePath,
    assetNegativeValidationPath,
  ]);

  if (copyReadbackPath !== undefined) {
    mkdirSync(dirname(copyReadbackPath), { recursive: true });
    copyFileSync(readbackPath, copyReadbackPath);
  }
  if (copyValidationPath !== undefined) {
    mkdirSync(dirname(copyValidationPath), { recursive: true });
    copyFileSync(validationPath, copyValidationPath);
  }

  writeJson(outputPath, {
    schemaVersion: "romeo.release-readback-smoke.v1",
    generatedAt,
    status: "passed",
    release: {
      name: manifest.name,
      version: manifest.version,
      manifest: fileEvidence(
        manifestPath,
        "dist/release/release-manifest.json",
      ),
    },
    checks: [
      check("credentialed npm package readback", positiveCollect),
      check("verified OCI image readback", positiveValidate),
      check("verified Helm chart readback", positiveValidate),
      check("verified release asset readback", positiveValidate),
      check("declared-only required image rejection", imageNegative),
      check("declared-only required chart rejection", chartNegative),
      check("declared-only required release asset rejection", assetNegative),
      { name: "readback evidence token redaction", status: "passed" },
    ],
    registryFixture: {
      packageCount: manifest.artifacts.length,
      imageDigest: `sha256:${ociDigest}`,
      chartDigest: `sha256:${chartDigest}`,
      assetCount: releaseAssets.length,
      assetNames: releaseAssets.map((asset) => asset.name),
      authSchemes: ["bearer"],
    },
    evidence: {
      readback: fileEvidence(readbackPath, "release-readback.json"),
      validation: fileEvidence(validationPath, "readback-validation.json"),
      copiedReadback:
        copyReadbackPath === undefined
          ? undefined
          : fileEvidence(copyReadbackPath, "copied-release-readback.json"),
      copiedValidation:
        copyValidationPath === undefined
          ? undefined
          : fileEvidence(copyValidationPath, "copied-readback-validation.json"),
      declaredImageValidation: fileEvidence(
        imageNegativeValidationPath,
        "declared-image-validation.json",
      ),
      declaredChartValidation: fileEvidence(
        chartNegativeValidationPath,
        "declared-chart-validation.json",
      ),
      declaredAssetValidation: fileEvidence(
        assetNegativeValidationPath,
        "declared-asset-validation.json",
      ),
    },
  });
  console.log(`Wrote release readback smoke evidence to ${outputPath}`);
} finally {
  await close(server);
  rmSync(tempDir, { recursive: true, force: true });
}

function handleRequest(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  const path = decodeURIComponent(url.pathname);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (path === "/@romeo/api-client" || path === "/@romeo/cli") {
    if (!hasBearer(request, tokens.npm)) return unauthorized(response);
    const artifact = manifest.artifacts.find(
      (item) => item.name === path.slice(1),
    );
    if (artifact === undefined) return notFound(response);
    return json(response, {
      name: artifact.name,
      "dist-tags": { latest: artifact.version },
      versions: {
        [artifact.version]: {
          name: artifact.name,
          version: artifact.version,
          dist: {
            tarball: `${baseUrl}/tarballs/${artifact.file}`,
            integrity: "sha512-fixture",
          },
        },
      },
    });
  }

  if (path.startsWith("/tarballs/")) {
    if (!hasBearer(request, tokens.npm)) return unauthorized(response);
    const file = basename(path);
    if (!artifactByFile.has(file)) return notFound(response);
    response.writeHead(200, { "content-type": "application/octet-stream" });
    createReadStream(repoPath(`dist/release/${file}`)).pipe(response);
    return;
  }

  if (path === "/v2/romeo/app/manifests/0.1.0") {
    if (!hasBearer(request, tokens.oci)) return unauthorized(response);
    response.writeHead(200, {
      "content-type": "application/vnd.oci.image.manifest.v1+json",
      "docker-content-digest": `sha256:${ociDigest}`,
    });
    response.end(ociManifest);
    return;
  }

  if (path === "/helm/index.yaml") {
    if (!hasBearer(request, tokens.helm)) return unauthorized(response);
    response.writeHead(200, { "content-type": "application/x-yaml" });
    response.end(
      [
        "apiVersion: v1",
        "entries:",
        "  romeo:",
        `    - version: ${manifest.version}`,
        `      appVersion: ${manifest.version}`,
        `      digest: ${chartDigest}`,
        "      urls:",
        "        - romeo-0.1.0.tgz",
        "",
      ].join("\n"),
    );
    return;
  }

  if (path === "/helm/romeo-0.1.0.tgz") {
    if (!hasBearer(request, tokens.helm)) return unauthorized(response);
    response.writeHead(200, { "content-type": "application/gzip" });
    response.end(chartBytes);
    return;
  }

  if (path.startsWith("/assets/")) {
    if (!hasBearer(request, tokens.asset)) return unauthorized(response);
    const asset = releaseAssets.find((item) => item.route === path);
    if (asset === undefined) return notFound(response);
    response.writeHead(200, { "content-type": "application/json" });
    createReadStream(asset.path).pipe(response);
    return;
  }

  return notFound(response);
}

function declaredReadback({ image, chart, assetName } = {}) {
  return {
    schemaVersion: "romeo.release-readback.v1",
    generatedAt,
    mode: "live_registry_readback",
    status: "collected",
    release: { name: manifest.name, version: manifest.version },
    registries: {
      npm: {
        auth: {
          tokenConfigured: true,
          credentialsUsed: true,
        },
      },
    },
    packages: manifest.artifacts.map((artifact) => ({
      name: artifact.name,
      version: artifact.version,
      sha256: artifact.sha256,
    })),
    images:
      image === undefined
        ? []
        : [
            {
              image,
              source: "declared",
              digest: `sha256:${"1".repeat(64)}`,
            },
          ],
    helmCharts:
      chart === true
        ? [
            {
              name: "romeo",
              version: manifest.version,
              source: "declared",
              digest: `sha256:${"2".repeat(64)}`,
            },
          ]
        : [],
    assets:
      assetName === undefined
        ? []
        : [
            {
              name: assetName,
              source: "declared",
              status: "declared_without_release_asset_readback",
              digest: `sha256:${"3".repeat(64)}`,
              sha256: "3".repeat(64),
              expectedSha256: "3".repeat(64),
            },
          ],
  };
}

function assertFailedCheck(path, expectedName) {
  const validation = readJson(path);
  if (validation.status !== "fail") {
    throw new Error(`${path} was expected to fail.`);
  }
  const failed = validation.checks
    .filter((item) => item.status === "fail")
    .map((item) => item.name);
  if (!failed.includes(expectedName)) {
    throw new Error(
      `${path} did not include expected failure ${expectedName}.`,
    );
  }
}

function assertNoTokenLeak(paths) {
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    if (content.includes("Bearer")) {
      throw new Error(`${path} leaked an Authorization scheme.`);
    }
    for (const token of Object.values(tokens)) {
      if (content.includes(token)) {
        throw new Error(`${path} leaked a token value.`);
      }
    }
  }
}

function check(name, command) {
  return {
    name,
    status: "passed",
    stdoutSha256: sha256String(command.stdout),
    stderrSha256: sha256String(command.stderr),
  };
}

function runNodeScript(script, args, env = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [repoPath(script), ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      const failed = code !== 0;
      if (failed !== Boolean(options.expectFailure)) {
        reject(
          new Error(
            `${script} exited ${code}; expected failure=${Boolean(options.expectFailure)}\n${redactOutput(stdout)}\n${redactOutput(stderr)}`,
          ),
        );
        return;
      }
      resolve({ stdout: redactOutput(stdout), stderr: redactOutput(stderr) });
    });
  });
}

function redactOutput(value) {
  let redacted = value;
  for (const token of Object.values(tokens)) {
    redacted = redacted.replaceAll(token, "[redacted]");
  }
  return redacted.replaceAll(/Bearer\s+\S+/gu, "Bearer [redacted]");
}

function listen(input) {
  return new Promise((resolve) => input.listen(0, "127.0.0.1", resolve));
}

function close(input) {
  return new Promise((resolve) => input.close(resolve));
}

function json(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function unauthorized(response) {
  response.writeHead(401, { "content-type": "text/plain" });
  response.end("unauthorized");
}

function notFound(response) {
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
}

function hasBearer(request, token) {
  return request.headers.authorization === `Bearer ${token}`;
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256String(value) {
  return sha256Buffer(Buffer.from(value));
}
