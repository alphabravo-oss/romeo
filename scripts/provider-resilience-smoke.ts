import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  BaseModel,
  ModelProviderAdapter,
  ProviderInstance,
} from "../packages/providers/src/types";
import {
  ProviderCircuitBreaker,
  streamRunEvents,
  type RunEvent,
} from "../packages/ai-runtime/src/index";

const output = argValue("--output");
const rawSentinel = `RAW_PROVIDER_RESILIENCE_SENTINEL_${process.pid}`;

const provider: ProviderInstance = {
  id: "provider_resilience_smoke",
  orgId: "org_default",
  type: "openai-compatible",
  name: "Provider Resilience Smoke",
  baseUrl: "https://provider.example",
  enabled: true,
  capabilities: {
    streaming: true,
    toolCalling: false,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    modalities: ["text"],
    deployment: {
      mode: "hosted-api",
      networkAccess: "external-http",
      credentialRequired: true,
    },
  },
};

const model: BaseModel = {
  id: "model_resilience_smoke",
  providerId: provider.id,
  name: "resilience-smoke",
  displayName: "Resilience Smoke",
  enabled: true,
  capabilities: provider.capabilities,
  contextWindow: 8192,
};

const fallbackProvider: ProviderInstance = {
  id: "provider_resilience_fallback",
  orgId: "org_default",
  type: "ollama",
  name: "Provider Resilience Fallback",
  baseUrl: "http://ollama.example",
  enabled: true,
  capabilities: {
    streaming: true,
    toolCalling: false,
    vision: false,
    audioInput: false,
    structuredJson: false,
    reasoning: false,
    modalities: ["text"],
    deployment: {
      mode: "local-runtime",
      networkAccess: "local-http",
      credentialRequired: false,
    },
  },
};

const fallbackModel: BaseModel = {
  id: "model_resilience_fallback",
  providerId: fallbackProvider.id,
  name: "resilience-fallback",
  displayName: "Resilience Fallback",
  enabled: true,
  capabilities: fallbackProvider.capabilities,
  contextWindow: 8192,
};

const retryCase = await runRetryCase(rawSentinel);
const noRetryAfterOutputCase = await runNoRetryAfterOutputCase(rawSentinel);
const circuitCase = await runCircuitCase(rawSentinel);
const fallbackCase = await runFallbackCase(rawSentinel);
const killSwitchCase = await runKillSwitchCase(rawSentinel);

const evidence = {
  schemaVersion: "romeo.provider-resilience-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "pre_output_retry",
    "no_retry_after_output",
    "circuit_breaker_fail_fast",
    "provider_fallback_before_output",
    "provider_kill_switch_fallback",
    "raw_provider_error_redaction",
  ],
  cases: [
    retryCase,
    noRetryAfterOutputCase,
    circuitCase,
    fallbackCase,
    killSwitchCase,
  ],
  redaction: {
    rawProviderErrorsReturned: false,
    rawProviderPayloadsReturned: false,
    rawProviderResponsesReturned: false,
    rawRunPromptsReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (serialized.includes(rawSentinel)) {
  throw new Error("Provider resilience smoke leaked a raw provider sentinel.");
}

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote provider resilience smoke evidence to ${outputPath}`);
}

async function runRetryCase(sentinel: string) {
  let calls = 0;
  const adapter = testAdapter(async function* () {
    calls += 1;
    if (calls === 1) {
      throw new Error(`temporary provider outage ${sentinel}`);
    }
    yield "ok";
  });
  const events = await collectRunEvents(
    streamRunEvents({
      adapter,
      provider,
      model,
      runId: "run_provider_resilience_retry",
      messages: [{ role: "user", content: sentinel }],
      providerRetryPolicy: { maxRetries: 1, backoffMs: 0 },
    }),
  );
  const terminal = terminalEvent(events);
  if (calls !== 2)
    throw new Error(
      `Expected retry case to call provider twice, saw ${calls}.`,
    );
  if (terminal.type !== "run.completed")
    throw new Error("Retry case did not complete.");
  if (
    (terminal.data as { providerRetryAttempts?: number })
      .providerRetryAttempts !== 1
  ) {
    throw new Error("Retry case did not record one retry attempt.");
  }
  return {
    name: "pre_output_retry",
    providerCallCount: calls,
    eventTypes: events.map((event) => event.type),
    terminalData: terminal.data,
  };
}

async function runNoRetryAfterOutputCase(sentinel: string) {
  let calls = 0;
  const adapter = testAdapter(async function* () {
    calls += 1;
    yield "partial";
    throw new Error(`provider failed after partial output ${sentinel}`);
  });
  const events = await collectRunEvents(
    streamRunEvents({
      adapter,
      provider,
      model,
      runId: "run_provider_resilience_partial",
      messages: [{ role: "user", content: "partial failure" }],
      providerRetryPolicy: { maxRetries: 2, backoffMs: 0 },
    }),
  );
  const terminal = terminalEvent(events);
  if (calls !== 1)
    throw new Error(
      `Expected partial case to avoid retry, saw ${calls} calls.`,
    );
  if (terminal.type !== "run.failed")
    throw new Error("Partial failure case did not fail.");
  if (
    (terminal.data as { errorCode?: string }).errorCode !==
    "provider_stream_error"
  ) {
    throw new Error("Partial failure case did not use provider_stream_error.");
  }
  return {
    name: "no_retry_after_output",
    providerCallCount: calls,
    eventTypes: events.map((event) => event.type),
    terminalData: terminal.data,
  };
}

async function runCircuitCase(sentinel: string) {
  let calls = 0;
  const adapter = testAdapter(async function* () {
    calls += 1;
    throw new Error(`provider circuit failure ${sentinel}`);
  });
  const breaker = new ProviderCircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 60_000,
  });
  const terminals = [];
  for (const runId of [
    "run_provider_resilience_circuit_1",
    "run_provider_resilience_circuit_2",
    "run_provider_resilience_circuit_3",
  ]) {
    const events = await collectRunEvents(
      streamRunEvents({
        adapter,
        provider,
        model,
        runId,
        messages: [{ role: "user", content: "circuit failure" }],
        providerCircuitBreaker: breaker,
      }),
    );
    terminals.push(terminalEvent(events).data);
  }
  if (calls !== 2)
    throw new Error(
      `Expected open circuit to avoid third provider call, saw ${calls}.`,
    );
  if (
    (terminals[2] as { errorCode?: string }).errorCode !==
    "provider_circuit_open"
  ) {
    throw new Error(
      "Open circuit did not fail fast with provider_circuit_open.",
    );
  }
  return {
    name: "circuit_breaker_fail_fast",
    providerCallCount: calls,
    terminalData: terminals,
  };
}

async function runFallbackCase(sentinel: string) {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primaryAdapter = testAdapter(async function* () {
    primaryCalls += 1;
    throw new Error(`primary provider failed before output ${sentinel}`);
  });
  const fallbackAdapter = fallbackTestAdapter(async function* () {
    fallbackCalls += 1;
    yield "fallback ok";
  });
  const events = await collectRunEvents(
    streamRunEvents({
      adapter: primaryAdapter,
      provider,
      model,
      runId: "run_provider_resilience_fallback",
      messages: [{ role: "user", content: sentinel }],
      providerFallback: {
        adapter: fallbackAdapter,
        provider: fallbackProvider,
        model: fallbackModel,
      },
    }),
  );
  const terminal = terminalEvent(events);
  if (primaryCalls !== 1)
    throw new Error(
      `Expected primary provider to be called once, saw ${primaryCalls}.`,
    );
  if (fallbackCalls !== 1)
    throw new Error(
      `Expected fallback provider to be called once, saw ${fallbackCalls}.`,
    );
  const fallback = (terminal.data as { providerFallback?: { reason?: string } })
    .providerFallback;
  if (
    terminal.type !== "run.completed" ||
    fallback?.reason !== "provider_stream_error"
  ) {
    throw new Error(
      "Fallback case did not complete with provider fallback metadata.",
    );
  }
  return {
    name: "provider_fallback_before_output",
    providerCallCount: { primary: primaryCalls, fallback: fallbackCalls },
    eventTypes: events.map((event) => event.type),
    terminalData: terminal.data,
  };
}

async function runKillSwitchCase(sentinel: string) {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primaryAdapter = testAdapter(async function* () {
    primaryCalls += 1;
    throw new Error(`kill-switched provider should not run ${sentinel}`);
  });
  const fallbackAdapter = fallbackTestAdapter(async function* () {
    fallbackCalls += 1;
    yield "kill switch fallback ok";
  });
  const events = await collectRunEvents(
    streamRunEvents({
      adapter: primaryAdapter,
      provider,
      model,
      runId: "run_provider_resilience_kill_switch",
      messages: [{ role: "user", content: sentinel }],
      providerDisabled: true,
      providerFallback: {
        adapter: fallbackAdapter,
        provider: fallbackProvider,
        model: fallbackModel,
      },
    }),
  );
  const terminal = terminalEvent(events);
  if (primaryCalls !== 0)
    throw new Error(
      `Expected disabled provider not to run, saw ${primaryCalls} calls.`,
    );
  if (fallbackCalls !== 1)
    throw new Error(
      `Expected fallback provider to be called once, saw ${fallbackCalls}.`,
    );
  const fallback = (terminal.data as { providerFallback?: { reason?: string } })
    .providerFallback;
  if (
    terminal.type !== "run.completed" ||
    fallback?.reason !== "provider_disabled"
  ) {
    throw new Error(
      "Kill-switch case did not complete with provider_disabled fallback metadata.",
    );
  }
  return {
    name: "provider_kill_switch_fallback",
    providerCallCount: { primary: primaryCalls, fallback: fallbackCalls },
    eventTypes: events.map((event) => event.type),
    terminalData: terminal.data,
  };
}

async function collectRunEvents(
  events: AsyncIterable<RunEvent>,
): Promise<RunEvent[]> {
  const collected: RunEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function terminalEvent(events: RunEvent[]): RunEvent {
  const event = events.at(-1);
  if (event === undefined) throw new Error("Run produced no events.");
  if (
    event.type !== "run.completed" &&
    event.type !== "run.failed" &&
    event.type !== "run.cancelled"
  ) {
    throw new Error(`Run ended without a terminal event: ${event.type}`);
  }
  return event;
}

function testAdapter(
  streamChat: ModelProviderAdapter["streamChat"],
): ModelProviderAdapter {
  return {
    kind: "openai-compatible",
    async health() {
      return { ok: true, message: "ok" };
    },
    async listModels() {
      return [model];
    },
    streamChat,
  };
}

function fallbackTestAdapter(
  streamChat: ModelProviderAdapter["streamChat"],
): ModelProviderAdapter {
  return {
    kind: "ollama",
    async health() {
      return { ok: true, message: "ok" };
    },
    async listModels() {
      return [fallbackModel];
    },
    streamChat,
  };
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
