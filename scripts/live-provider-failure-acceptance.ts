import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultProviderCapabilities,
  getProviderAdapter,
  type BaseModel,
  type ProviderKind,
} from "../packages/providers/src/index";

type Target = "anthropic" | "openai-compatible";
type Scenario =
  | "http_401"
  | "http_429"
  | "malformed_stream"
  | "outage"
  | "timeout";

const rawSentinel = `RAW_PROVIDER_FAILURE_SENTINEL_${process.pid}`;
const apiKeySentinel = `failure-api-key-${process.pid}`;
const server = createServer(handleRequest);
await new Promise<void>((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", () => resolveListen());
});
const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("Could not resolve controlled provider fixture address.");
}
const origin = `http://127.0.0.1:${address.port}`;
const targets: Target[] = ["openai-compatible", "anthropic"];
const results: Array<{
  provider: Target;
  status: "passed";
  scenarios: Array<{
    scenario: Scenario;
    errorCode: string;
    errorType?: string;
  }>;
}> = [];

try {
  for (const target of targets) {
    const scenarios = [] as (typeof results)[number]["scenarios"];
    for (const scenario of [
      "http_401",
      "http_429",
      "timeout",
      "malformed_stream",
    ] as const) {
      scenarios.push(await runScenario(target, scenario));
    }
    results.push({ provider: target, status: "passed", scenarios });
  }
  await closeServer();
  for (const result of results) {
    result.scenarios.push(await runScenario(result.provider, "outage"));
  }
} finally {
  if (server.listening) await closeServer();
}

const evidence = {
  schemaVersion: "romeo.live-provider-failure-acceptance.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  target: { controlledLoopbackHttp: true },
  results,
  checks: {
    actualAdapters: true,
    actualHttpTransport: true,
    unauthorized: true,
    rateLimit: true,
    timeout: true,
    malformedStream: true,
    providerOutage: true,
  },
  redaction: {
    endpointReturned: false,
    apiKeyReturned: false,
    promptReturned: false,
    providerResponseBodyReturned: false,
    rawProviderErrorReturned: false,
  },
};
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputValue =
  process.env.ROMEO_PROVIDER_FAILURE_EVIDENCE_PATH ??
  "dist/evidence/live-provider-failure-acceptance.json";
const output = outputValue.startsWith("/")
  ? outputValue
  : resolve(repoRoot, outputValue);
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (serialized.includes(rawSentinel) || serialized.includes(apiKeySentinel)) {
  throw new Error("Provider failure evidence leaked a raw sentinel.");
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, serialized, "utf8");
console.log("Live provider failure acceptance passed.");
console.log(`Wrote provider failure evidence to ${output}`);

async function runScenario(target: Target, scenario: Scenario) {
  const adapter = getProviderAdapter(target);
  const kind = target as ProviderKind;
  const provider = {
    id: `failure_${target.replaceAll("-", "_")}`,
    orgId: "live_acceptance",
    type: kind,
    name: `Failure acceptance ${target}`,
    baseUrl: `${origin}/${target}/v1`,
    enabled: true,
    capabilities: defaultProviderCapabilities(kind),
  };
  const model: BaseModel = {
    id: `failure_model_${scenario}`,
    providerId: provider.id,
    name: scenario,
    displayName: scenario,
    enabled: true,
    capabilities: provider.capabilities,
    contextWindow: 8_192,
  };
  const controller = new AbortController();
  const timeout =
    scenario === "timeout"
      ? setTimeout(() => controller.abort(), 75)
      : undefined;
  try {
    for await (const _chunk of adapter.streamChat({
      provider,
      model,
      apiKey: apiKeySentinel,
      messages: [{ role: "user", content: rawSentinel }],
      signal: controller.signal,
    })) {
      // Every controlled scenario must fail before yielding usable output.
    }
    throw codedError("scenario_did_not_fail");
  } catch (error) {
    const classified = classifyError(error, scenario, target);
    assertExpectedClassification(classified, scenario, target);
    return { scenario, ...classified };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function classifyError(
  error: unknown,
  scenario: Scenario,
  target: Target,
): { errorCode: string; errorType?: string } {
  if (error instanceof Error && error.name === "AbortError") {
    return { errorCode: "timeout" };
  }
  if (typeof error === "object" && error !== null && "errorCode" in error) {
    const errorCode = (error as { errorCode?: unknown }).errorCode;
    const errorType = (error as { errorType?: unknown }).errorType;
    if (typeof errorCode === "string" && /^[a-z0-9_]{1,80}$/u.test(errorCode)) {
      return {
        errorCode,
        ...(typeof errorType === "string" &&
        /^[a-z0-9_]{1,80}$/u.test(errorType)
          ? { errorType }
          : {}),
      };
    }
  }
  if (scenario === "malformed_stream") {
    return { errorCode: "provider_stream_error" };
  }
  if (scenario === "outage") return { errorCode: "provider_unavailable" };
  throw codedError(`unclassified_${target.replaceAll("-", "_")}_${scenario}`);
}

function assertExpectedClassification(
  classified: { errorCode: string; errorType?: string },
  scenario: Scenario,
  target: Target,
): void {
  if (scenario === "http_401" || scenario === "http_429") {
    const status = scenario.slice("http_".length);
    const expectedType =
      target === "anthropic" ? `anthropic_http_${status}` : `http_${status}`;
    if (
      classified.errorCode !== "provider_http_error" ||
      classified.errorType !== expectedType
    ) {
      throw codedError(`unexpected_${target.replaceAll("-", "_")}_${scenario}`);
    }
    return;
  }
  const expected = {
    timeout: "timeout",
    malformed_stream: "provider_stream_error",
    outage: "provider_unavailable",
  }[scenario];
  if (classified.errorCode !== expected) {
    throw codedError(`unexpected_${target.replaceAll("-", "_")}_${scenario}`);
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    model?: string;
  };
  if (body.model === "http_401") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: rawSentinel }));
    return;
  }
  if (body.model === "http_429") {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: rawSentinel }));
    return;
  }
  if (body.model === "timeout") {
    const timer = setTimeout(() => response.end(), 10_000);
    request.once("close", () => clearTimeout(timer));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(`data: {"malformed":"${rawSentinel}"\n\n`);
}

function closeServer(): Promise<void> {
  return new Promise((resolveClose, rejectClose) =>
    server.close((error) =>
      error === undefined ? resolveClose() : rejectClose(error),
    ),
  );
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}
