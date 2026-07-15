import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  argValue,
  ensureParentDirectory,
  printPlan,
  redactedRemoteUrl,
  repoPath,
} from "./lib/postgres-maintenance.mjs";

const outputPath = argValue("--output");
const secretSentinel = "postgres-backup-upload-secret-sentinel";
const tempDir = mkdtempSync(join(tmpdir(), "romeo-postgres-upload-"));
const fakePgDump = join(tempDir, "fake-pg-dump.sh");

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
printf "fake-postgres-backup" > "$output"
`,
  "utf8",
);
chmodSync(fakePgDump, 0o700);

const requests = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url });
  request.resume();
  if (request.url?.startsWith("/timeout") === true) {
    setTimeout(() => {
      if (!response.writableEnded) {
        response.statusCode = 200;
        response.end("late");
      }
    }, 250);
    return;
  }
  response.writeHead(503, { connection: "close" });
  response.end("unavailable");
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Failed to start local upload smoke server.");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const cases = [
    await runFailureCase({
      baseUrl,
      expectedError: "Backup upload failed with HTTP 503.",
      name: "http_503",
      path: "/failure",
      timeoutMs: 1000,
    }),
    await runFailureCase({
      baseUrl,
      expectedError: "Backup upload timed out after 100ms.",
      name: "upload_timeout",
      path: "/timeout",
      timeoutMs: 100,
    }),
  ];

  const evidence = {
    schemaVersion: "romeo.postgres-backup-upload-failure-smoke.v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    checks: [
      "upload_http_failure_exits_nonzero",
      "upload_timeout_exits_nonzero",
      "failed_upload_does_not_write_manifest",
      "upload_failure_output_redacts_presigned_secret",
    ],
    cases,
    requestCount: requests.length,
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

async function runFailureCase({
  baseUrl,
  expectedError,
  name,
  path,
  timeoutMs,
}) {
  const output = join(tempDir, `${name}.dump`);
  const manifest = join(tempDir, `${name}.manifest.json`);
  const uploadUrl = `${baseUrl}${path}?token=${secretSentinel}&name=${name}`;
  const requestCountBefore = requests.length;
  const result = await runBackupCommand(
    process.execPath,
    [
      repoPath("scripts/postgres-backup.mjs"),
      "--pg-dump",
      fakePgDump,
      "--output",
      output,
      "--manifest-output",
      manifest,
      "--upload-timeout-ms",
      String(timeoutMs),
    ],
    {
      cwd: repoPath("."),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://romeo:database-secret@db.invalid/romeo",
        POSTGRES_BACKUP_UPLOAD_URL: uploadUrl,
      },
    },
  );

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    throw new Error(`${name} backup upload failure unexpectedly succeeded.`);
  }
  if (result.error !== undefined) {
    throw result.error;
  }
  if (!combinedOutput.includes(expectedError)) {
    throw new Error(
      `${name} backup upload failure did not include expected stable error code. Server requests: ${requests.length}. Output: ${redact(combinedOutput).slice(0, 500)}`,
    );
  }
  if (combinedOutput.includes(secretSentinel)) {
    throw new Error(
      `${name} backup upload failure leaked presigned URL secret.`,
    );
  }
  if (existsSync(manifest)) {
    throw new Error(`${name} failed backup upload wrote a success manifest.`);
  }
  if (requests.length <= requestCountBefore) {
    throw new Error(`${name} backup upload did not reach local test server.`);
  }

  return {
    name,
    exitStatus: result.status,
    manifestWritten: false,
    requestReceived: true,
    redactedUploadUrl: redactedRemoteUrl(uploadUrl),
  };
}

function runBackupCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("Backup upload smoke child process timed out."));
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });
}

function redact(value) {
  return value.replaceAll(secretSentinel, "[redacted]");
}

function resolveOutputPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}
