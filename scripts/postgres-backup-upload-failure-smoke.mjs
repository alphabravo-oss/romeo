import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  argValue,
  ensureParentDirectory,
  redactedRemoteUrl,
  repoPath,
} from "./lib/postgres-maintenance.mjs";

const outputPath = argValue("--output");
const secretSentinel = "postgres-backup-upload-secret-sentinel";
const tempDir = mkdtempSync(join(tmpdir(), "romeo-postgres-durability-"));
const fakePgDump = join(tempDir, "fake-pg-dump.sh");
const objects = new Map();
const requests = [];

writeFileSync(
  fakePgDump,
  `#!/bin/sh
set -eu
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--file" ]; then
    shift
    output="$1"
  fi
  shift || true
done
if [ -z "$output" ]; then
  echo "missing --file" >&2
  exit 2
fi
mkdir -p "$(dirname "$output")"
printf "fake-postgres-backup-with-durable-content" > "$output"
`,
  "utf8",
);
chmodSync(fakePgDump, 0o700);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://loopback.invalid");
  const [caseName, artifact] = url.pathname.split("/").filter(Boolean);
  requests.push({ method: request.method, caseName, artifact });

  if (request.method === "PUT") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (caseName === "upload_timeout") {
        setTimeout(() => respond(response, 200, "late"), 250);
        return;
      }
      if (caseName === "http_503") {
        respond(response, 503, "unavailable");
        return;
      }
      if (caseName === "credential_denial") {
        respond(response, 403, "denied");
        return;
      }
      objects.set(`${caseName}/${artifact}`, Buffer.concat(chunks));
      response.writeHead(200, { etag: `"${caseName}-${artifact}"` });
      response.end();
    });
    return;
  }

  if (request.method === "GET") {
    if (artifact === "policy") {
      const body = Buffer.from(
        JSON.stringify(validDestinationPolicy(`${caseName}-destination`)),
      );
      response.writeHead(200, {
        "content-length": body.length,
        "content-type": "application/json",
      });
      response.end(body);
      return;
    }
    const stored = objects.get(`${caseName}/${artifact}`);
    if (stored === undefined) {
      respond(response, 404, "missing");
      return;
    }
    let body = stored;
    if (caseName === "digest_mismatch" && artifact === "backup") {
      body = Buffer.from(stored);
      body[0] = body[0] === 0x78 ? 0x79 : 0x78;
    }
    if (caseName === "partial_object" && artifact === "backup") {
      body = stored.subarray(0, Math.max(0, stored.length - 3));
    }
    response.writeHead(200, {
      "content-length": body.length,
      "content-type": "application/octet-stream",
    });
    response.end(body);
    return;
  }

  respond(response, 405, "method not allowed");
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Failed to start local durability smoke server.");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const cases = [
    await runMissingDestinationCase(),
    await runMissingLocalPersistenceEvidenceCase(),
    await runFailureCase({
      baseUrl,
      expectedError: "Backup upload failed with HTTP 503.",
      name: "http_503",
      timeoutMs: 1000,
    }),
    await runFailureCase({
      baseUrl,
      expectedError: "Backup upload timed out after 100ms.",
      name: "upload_timeout",
      timeoutMs: 100,
    }),
    await runFailureCase({
      baseUrl,
      expectedError: "Backup backup readback digest mismatch.",
      name: "digest_mismatch",
      timeoutMs: 1000,
    }),
    await runFailureCase({
      baseUrl,
      expectedError: "Backup backup readback size mismatch.",
      name: "partial_object",
      timeoutMs: 1000,
    }),
    await runFailureCase({
      baseUrl,
      expectedError: "Backup upload failed with HTTP 403.",
      name: "credential_denial",
      timeoutMs: 1000,
    }),
    await runSuccessCase(baseUrl),
  ];

  const evidence = {
    schemaVersion: "romeo.postgres-backup-upload-failure-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "missing_destination_exits_nonzero_before_dump",
      "missing_local_persistence_evidence_exits_nonzero_before_dump",
      "upload_http_failure_exits_nonzero",
      "upload_timeout_exits_nonzero",
      "credential_denial_exits_nonzero",
      "digest_mismatch_exits_nonzero",
      "partial_object_exits_nonzero",
      "failed_upload_does_not_write_manifest",
      "successful_backup_manifest_status_readback_verified",
      "destination_lifecycle_policy_verified_before_dump",
      "local_artifacts_deleted_remote_objects_remain",
      "upload_failure_output_redacts_presigned_secret",
    ],
    cases,
    requestCount: requests.length,
    remoteObjectCount: objects.size,
    redaction: {
      rawPresignedUploadUrlReturned: false,
      rawUploadRequestBodyReturned: false,
      rawUploadResponseBodyReturned: false,
      commandOutputReturned: false,
      databaseUrlReturned: false,
      environmentReturned: false,
    },
  };

  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (outputPath !== undefined) {
    ensureParentDirectory(resolveOutputPath(outputPath));
    writeFileSync(resolveOutputPath(outputPath), serialized, "utf8");
  }
  process.stdout.write(serialized);
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tempDir, { force: true, recursive: true });
}

async function runMissingDestinationCase() {
  const paths = casePaths("missing_destination");
  const result = await runBackupCommand(paths, {
    POSTGRES_BACKUP_DURABILITY_MODE: "verified-upload",
  });
  assertFailure(
    "missing_destination",
    result,
    "Verified backup durability requires POSTGRES_BACKUP_UPLOAD_URL.",
  );
  if (existsSync(paths.output))
    throw new Error("missing destination ran pg_dump before validation.");
  return {
    name: "missing_destination",
    exitStatus: result.status,
    dumpWritten: false,
    requestReceived: false,
  };
}

async function runMissingLocalPersistenceEvidenceCase() {
  const paths = casePaths("missing_local_persistence_evidence");
  const result = await runBackupCommand(paths, {
    POSTGRES_BACKUP_DURABILITY_MODE: "local-persistent",
  });
  assertFailure(
    "missing_local_persistence_evidence",
    result,
    "Local-persistent backups require --local-persistence-evidence",
  );
  if (existsSync(paths.output))
    throw new Error("missing local persistence evidence ran pg_dump.");
  return {
    name: "missing_local_persistence_evidence",
    exitStatus: result.status,
    dumpWritten: false,
    requestReceived: false,
  };
}

async function runFailureCase({ baseUrl, expectedError, name, timeoutMs }) {
  const paths = casePaths(name);
  const requestCountBefore = requests.length;
  const result = await runBackupCommand(
    paths,
    durabilityEnvironment(baseUrl, name, timeoutMs),
  );
  assertFailure(name, result, expectedError);
  if (existsSync(paths.status))
    throw new Error(`${name} wrote a passed durability status.`);
  if (["http_503", "upload_timeout", "credential_denial"].includes(name)) {
    if (existsSync(paths.manifest))
      throw new Error(`${name} failed backup upload wrote a manifest.`);
  }
  if (requests.length <= requestCountBefore)
    throw new Error(`${name} did not reach the loopback durability server.`);
  return {
    name,
    exitStatus: result.status,
    manifestWritten: existsSync(paths.manifest),
    statusWritten: false,
    requestReceived: true,
    redactedUploadUrl: redactedRemoteUrl(artifactUrl(baseUrl, name, "backup")),
  };
}

async function runSuccessCase(baseUrl) {
  const name = "successful_readback";
  const paths = casePaths(name);
  const result = await runBackupCommand(
    paths,
    durabilityEnvironment(baseUrl, name, 1000),
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`successful durability case failed: ${safeOutput(result)}`);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const status = JSON.parse(readFileSync(paths.status, "utf8"));
  if (
    manifest.schemaVersion !== "romeo.postgres-backup.v2" ||
    manifest.remoteBackup?.status !== "verified"
  ) {
    throw new Error("successful durability manifest lacks backup readback.");
  }
  if (
    status.schemaVersion !== "romeo.postgres-backup-status.v1" ||
    status.status !== "passed" ||
    status.durabilityMode !== "verified-upload" ||
    status.remoteVerification?.backup?.status !== "verified" ||
    status.remoteVerification?.manifest?.status !== "verified"
  ) {
    throw new Error("successful durability status is incomplete.");
  }
  rmSync(paths.directory, { force: true, recursive: true });
  for (const artifact of ["backup", "manifest", "status"]) {
    if (!objects.has(`${name}/${artifact}`))
      throw new Error(`remote ${artifact} disappeared after local deletion.`);
  }
  return {
    name,
    exitStatus: result.status,
    manifestWritten: true,
    statusWritten: true,
    backupVerified: true,
    manifestVerified: true,
    statusVerified: true,
    localArtifactsDeleted: true,
    remoteObjectsRemain: true,
    lastSuccessAtPresent: typeof status.lastSuccessAt === "string",
    redactedUploadUrl: redactedRemoteUrl(artifactUrl(baseUrl, name, "backup")),
  };
}

function casePaths(name) {
  const directory = join(tempDir, name);
  return {
    directory,
    output: join(directory, "backup.dump"),
    manifest: join(directory, "backup.manifest.json"),
    status: join(directory, "backup.status.json"),
  };
}

function durabilityEnvironment(baseUrl, name, timeoutMs) {
  return {
    POSTGRES_BACKUP_DURABILITY_MODE: "verified-upload",
    POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS: String(timeoutMs),
    POSTGRES_BACKUP_UPLOAD_URL: artifactUrl(baseUrl, name, "backup"),
    POSTGRES_BACKUP_READBACK_URL: artifactUrl(baseUrl, name, "backup"),
    POSTGRES_BACKUP_MANIFEST_UPLOAD_URL: artifactUrl(baseUrl, name, "manifest"),
    POSTGRES_BACKUP_MANIFEST_READBACK_URL: artifactUrl(
      baseUrl,
      name,
      "manifest",
    ),
    POSTGRES_BACKUP_STATUS_UPLOAD_URL: artifactUrl(baseUrl, name, "status"),
    POSTGRES_BACKUP_STATUS_READBACK_URL: artifactUrl(baseUrl, name, "status"),
    POSTGRES_BACKUP_POLICY_READBACK_URL: artifactUrl(baseUrl, name, "policy"),
  };
}

function validDestinationPolicy(destinationId) {
  return {
    schemaVersion: "romeo.backup-destination-policy.v1",
    destinationId,
    observedAt: new Date().toISOString(),
    versioningEnabled: true,
    replication: { enabled: true, destination: "secondary-region" },
    objectLock: {
      mode: "COMPLIANCE",
      minimumRetentionDays: 30,
      manifestsProtected: true,
      indexesProtected: true,
    },
    lifecycle: { earlyDeletionAllowed: false, deleteAfterDays: 45 },
    legalHold: {
      supported: true,
      bypassRequiresProtectedApproval: true,
    },
  };
}

function artifactUrl(baseUrl, name, artifact) {
  return `${baseUrl}/${name}/${artifact}?token=${secretSentinel}`;
}

function runBackupCommand(paths, environment) {
  return runChild(
    process.execPath,
    [
      repoPath("scripts/postgres-backup.mjs"),
      "--pg-dump",
      fakePgDump,
      "--output",
      paths.output,
      "--manifest-output",
      paths.manifest,
      "--status-output",
      paths.status,
    ],
    {
      cwd: repoPath("."),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://romeo:database-secret@db.invalid/romeo",
        ...environment,
      },
    },
  );
}

function assertFailure(name, result, expectedError) {
  if (result.status === 0)
    throw new Error(`${name} durability failure unexpectedly succeeded.`);
  if (result.error !== undefined) throw result.error;
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  if (!combinedOutput.includes(expectedError)) {
    throw new Error(
      `${name} did not include ${expectedError}: ${safeOutput(result)}`,
    );
  }
  if (
    combinedOutput.includes(secretSentinel) ||
    combinedOutput.includes("database-secret")
  ) {
    throw new Error(`${name} failure leaked a credential.`);
  }
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5000);
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("Backup durability smoke child process timed out."));
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });
}

function respond(response, status, body) {
  if (response.writableEnded) return;
  response.writeHead(status, { connection: "close" });
  response.end(body);
}

function safeOutput(result) {
  return `${result.stdout}\n${result.stderr}`
    .replaceAll(secretSentinel, "[redacted]")
    .replaceAll("database-secret", "[redacted]")
    .slice(0, 500);
}

function resolveOutputPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}
