import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRomeoApi,
  InMemoryRomeoRepository,
  type RomeoRepository,
} from "../packages/core/src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  repoRoot,
  argValue("--output") ?? "dist/evidence/live-log-redaction-acceptance.json",
);
const sentinels = {
  prompt: "RAW_PROMPT_SENTINEL_58f7d1",
  providerPayload: "RAW_PROVIDER_PAYLOAD_SENTINEL_86ac42",
  secret: "RAW_PROVIDER_API_SECRET_SENTINEL_39be05",
  requestId: "RAW_REQUEST_ID_SECRET_SENTINEL_b712c4",
  query: "RAW_QUERY_SECRET_SENTINEL_f0289a",
} as const;

const repository = new InMemoryRomeoRepository();
const injected = new Error(
  `prompt=${sentinels.prompt} provider_payload=${sentinels.providerPayload} secret=${sentinels.secret}`,
);
Object.assign(injected, {
  code: sentinels.secret,
  cause: sentinels.providerPayload,
  responseBody: sentinels.providerPayload,
});
const failingRepository = new Proxy(repository, {
  get(target, property, receiver) {
    if (property === "listProviders") {
      return async () => {
        throw injected;
      };
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as RomeoRepository;
const api = createRomeoApi(failingRepository);
const captured: unknown[][] = [];
const originalConsoleError = console.error;
let response: Response;
try {
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  response = await api.request(
    `/api/v1/providers?debug=${encodeURIComponent(sentinels.query)}`,
    { headers: { "x-request-id": sentinels.requestId } },
  );
} finally {
  console.error = originalConsoleError;
}

const responseBody = (await response.json()) as {
  error?: { code?: unknown; message?: unknown; request_id?: unknown };
};
if (
  response.status !== 500 ||
  responseBody.error?.code !== "internal_error" ||
  responseBody.error.message !== "Unexpected server error."
) {
  throw new Error("Unexpected-error response was not sanitized.");
}
if (captured.length !== 1) {
  throw new Error(
    `Expected exactly one error log; observed ${captured.length}.`,
  );
}
const serializedLog = JSON.stringify(captured);
for (const sentinel of Object.values(sentinels)) {
  if (serializedLog.includes(sentinel)) {
    throw new Error("Unexpected-error log retained a raw sentinel.");
  }
}
if (
  serializedLog.includes(injected.message) ||
  serializedLog.includes("responseBody") ||
  serializedLog.includes("cause") ||
  serializedLog.includes("/api/v1/providers")
) {
  throw new Error("Unexpected-error log retained unsafe request/error fields.");
}
const fields = Object.keys(
  (captured[0]?.[1] ?? {}) as Record<string, unknown>,
).sort();
if (
  JSON.stringify(fields) !==
  JSON.stringify(["errorKind", "method", "requestIdFingerprint"])
) {
  throw new Error("Unexpected-error log field allowlist changed.");
}

const evidence = {
  schemaVersion: "romeo.live-log-redaction-acceptance.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "full_api_unexpected_error_path",
    "generic_client_error_response",
    "prompt_sentinel_not_logged",
    "provider_payload_sentinel_not_logged",
    "secret_sentinel_not_logged",
    "query_sentinel_not_logged",
    "request_id_sentinel_fingerprinted",
    "raw_error_message_stack_cause_and_code_not_logged",
    "log_field_allowlist_enforced",
  ],
  observation: {
    errorLogCount: captured.length,
    fields,
    serializedLogBytes: Buffer.byteLength(serializedLog, "utf8"),
    serializedLogSha256: createHash("sha256")
      .update(serializedLog)
      .digest("hex"),
  },
  redaction: {
    promptReturned: false,
    providerPayloadReturned: false,
    secretReturned: false,
    queryReturned: false,
    rawRequestIdReturned: false,
    rawErrorReturned: false,
    requestPathReturned: false,
  },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Wrote live log-redaction evidence to ${outputPath}`);

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
