import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultProviderCapabilities,
  getProviderAdapter,
  type BaseModel,
  type StreamChatChunk,
} from "../packages/providers/src/index";

const host = process.env.ROMEO_OLLAMA_RESTART_HOST?.trim() || "127.0.0.1:11435";
const modelName = process.env.ROMEO_OLLAMA_RESTART_MODEL?.trim() || "gemma:2b";
const binary = process.env.ROMEO_OLLAMA_BINARY?.trim() || "ollama";
const baseUrl = `http://${host}/api`;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputValue =
  process.env.ROMEO_OLLAMA_RESTART_EVIDENCE_PATH ??
  "dist/evidence/live-ollama-restart-acceptance.json";
const output = outputValue.startsWith("/")
  ? outputValue
  : resolve(repoRoot, outputValue);
const adapter = getProviderAdapter("ollama");
const provider = {
  id: "live_ollama_restart",
  orgId: "live_acceptance",
  type: "ollama" as const,
  name: "Isolated Ollama restart acceptance",
  baseUrl,
  enabled: true,
  capabilities: defaultProviderCapabilities("ollama"),
};
const startedAt = performance.now();
const evidence: Record<string, unknown> = {
  schemaVersion: "romeo.live-ollama-restart-acceptance.v1",
  generatedAt: new Date().toISOString(),
  target: { loopback: true, isolatedPort: true },
  model: modelName,
  status: "failed",
};
let server: ChildProcess | undefined;

try {
  await assertPortUnavailableBeforeStart();
  server = startServer();
  await waitUntilReady();
  const model = requiredModel(await adapter.listModels(provider), modelName);
  const before = await collectText(
    adapter.streamChat({
      provider,
      model,
      messages: [
        { role: "user", content: "Reply briefly with ROMEO_BEFORE_RESTART." },
      ],
    }),
  );
  assert(before > 0, "before_restart_empty_stream");

  await stopServer(server);
  server = undefined;
  const outage = await adapter.health(provider);
  assert(!outage.ok, "restart_outage_not_observed");

  server = startServer();
  await waitUntilReady();
  const recoveredModel = requiredModel(
    await adapter.listModels(provider),
    modelName,
  );
  const after = await collectText(
    adapter.streamChat({
      provider,
      model: recoveredModel,
      messages: [
        { role: "user", content: "Reply briefly with ROMEO_AFTER_RESTART." },
      ],
    }),
  );
  assert(after > 0, "after_restart_empty_stream");

  evidence.checks = {
    initialHealth: true,
    initialStreaming: true,
    outageObservedAfterStop: true,
    healthRecoveredAfterRestart: true,
    modelRediscoveredAfterRestart: true,
    streamingRecoveredAfterRestart: true,
  };
  evidence.status = "passed";
} catch (error) {
  evidence.errorCode = safeErrorCode(error);
  process.exitCode = 1;
} finally {
  if (server !== undefined) await stopServer(server);
  evidence.durationMs = Math.round(performance.now() - startedAt);
  evidence.redaction = {
    processOutputReturned: false,
    promptReturned: false,
    responseReturned: false,
    modelPayloadReturned: false,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Ollama restart acceptance: ${evidence.status}`);
  console.log(`Wrote restart evidence to ${output}`);
}

function startServer(): ChildProcess {
  const child = spawn(binary, ["serve"], {
    env: { ...process.env, OLLAMA_HOST: host },
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) =>
      child.once("exit", () => resolveExit(true)),
    ),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise<void>((resolveExit) =>
        child.once("exit", () => resolveExit()),
      ),
      delay(2_000),
    ]);
  }
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const health = await adapter.health(provider);
      if (health.ok) return;
    } catch {
      // The isolated daemon is still starting.
    }
    await delay(200);
  }
  throw codedError("ollama_restart_start_timeout");
}

async function assertPortUnavailableBeforeStart(): Promise<void> {
  try {
    const response = await fetch(`http://${host}/api/tags`, {
      signal: AbortSignal.timeout(500),
    });
    if (response.ok) throw codedError("isolated_port_already_in_use");
  } catch (error) {
    if (safeErrorCode(error) === "isolated_port_already_in_use") throw error;
  }
}

function requiredModel(models: BaseModel[], name: string): BaseModel {
  const model = models.find((candidate) => candidate.name === name);
  if (model === undefined) throw codedError("restart_model_not_found");
  return model;
}

async function collectText(
  stream: AsyncIterable<StreamChatChunk>,
): Promise<number> {
  let length = 0;
  for await (const chunk of stream) {
    if (typeof chunk === "string") length += chunk.length;
  }
  return length;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw codedError(code);
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "errorCode" in error) {
    const value = (error as { errorCode?: unknown }).errorCode;
    if (typeof value === "string" && /^[a-z0-9_]{1,80}$/u.test(value)) {
      return value;
    }
  }
  return "ollama_restart_acceptance_failed";
}
