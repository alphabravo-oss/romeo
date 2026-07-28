import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultProviderCapabilities,
  getProviderAdapter,
  type BaseModel,
  type ProviderKind,
  type ProviderTokenUsage,
} from "../packages/providers/src/index";

const targets = ["ollama", "openai-compatible", "anthropic"] as const;
type Target = (typeof targets)[number];
type Status = "failed" | "not_configured" | "passed";

const requested = process.env.ROMEO_LIVE_PROVIDER?.trim();
const selected: Target[] =
  requested === undefined || requested === ""
    ? [...targets]
    : targets.includes(requested as Target)
      ? [requested as Target]
      : failConfiguration(`Unsupported ROMEO_LIVE_PROVIDER: ${requested}`);

const results = [] as Array<{
  provider: Target;
  status: Status;
  baseUrlOrigin?: string;
  model?: string;
  durationMs?: number;
  modelDiscoveryCount?: number;
  receivedText?: boolean;
  receivedUsage?: boolean;
  errorCode?: string;
}>;

for (const target of selected) results.push(await runTarget(target));

const evidence = {
  schemaVersion: "romeo.live-provider-acceptance.v1",
  generatedAt: new Date().toISOString(),
  results,
  summary: {
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    notConfigured: results.filter(
      (result) => result.status === "not_configured",
    ).length,
  },
};
const outputPath = resolve(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  process.env.ROMEO_LIVE_EVIDENCE_PATH ??
    "dist/evidence/live-provider-acceptance.json",
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Wrote redaction-safe live provider evidence to ${outputPath}`);
for (const result of results)
  console.log(
    `${result.provider}: ${result.status}${result.errorCode === undefined ? "" : ` (${result.errorCode})`}`,
  );
if (evidence.summary.failed > 0) process.exitCode = 1;

async function runTarget(target: Target): Promise<(typeof results)[number]> {
  const config = configuration(target);
  if (!config.configured) return { provider: target, status: "not_configured" };
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const kind = target as ProviderKind;
    const adapter = getProviderAdapter(kind);
    const provider = {
      id: `live_${target.replaceAll("-", "_")}`,
      orgId: "live_acceptance",
      type: kind,
      name: `Live ${target}`,
      baseUrl: config.baseUrl,
      enabled: true,
      capabilities: defaultProviderCapabilities(kind),
      modelIds: [config.model],
    };
    const discovered = await adapter.listModels(provider, {
      ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      fetchImpl: timeoutFetch(controller.signal),
    });
    const model: BaseModel = discovered.find(
      (candidate) => candidate.name === config.model,
    ) ?? {
      id: "live_model",
      providerId: provider.id,
      name: config.model,
      displayName: config.model,
      enabled: true,
      capabilities: provider.capabilities,
      contextWindow: 8_192,
    };
    let textLength = 0;
    let usage: ProviderTokenUsage | undefined;
    for await (const chunk of adapter.streamChat({
      provider,
      model,
      messages: [
        { role: "user", content: "Reply with exactly ROMEO_PROVIDER_OK" },
      ],
      ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      fetchImpl: timeoutFetch(controller.signal),
      signal: controller.signal,
    })) {
      if (typeof chunk === "string") textLength += chunk.length;
      else if (chunk.type === "usage") usage = chunk.usage;
    }
    if (textLength === 0) throw codedError("empty_stream");
    return {
      provider: target,
      status: "passed",
      baseUrlOrigin: new URL(config.baseUrl).origin,
      model: config.model,
      durationMs: Math.round(performance.now() - startedAt),
      modelDiscoveryCount: discovered.length,
      receivedText: true,
      receivedUsage: usage !== undefined,
    };
  } catch (error) {
    return {
      provider: target,
      status: "failed",
      baseUrlOrigin: safeOrigin(config.baseUrl),
      model: config.model,
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: safeErrorCode(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function configuration(target: Target) {
  const explicitBaseUrl = process.env.ROMEO_LIVE_BASE_URL?.trim();
  const explicitModel = process.env.ROMEO_LIVE_MODEL?.trim();
  const timeoutMs = positiveInteger(process.env.ROMEO_LIVE_TIMEOUT_MS, 90_000);
  if (target === "ollama") {
    return {
      configured: true,
      baseUrl: explicitBaseUrl || "http://127.0.0.1:11434",
      model: explicitModel || "llama3.2",
      apiKey: optionalSecret("OLLAMA_API_KEY"),
      timeoutMs,
    };
  }
  const apiKey =
    process.env.ROMEO_LIVE_API_KEY?.trim() ||
    optionalSecret(
      target === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY",
    );
  return {
    configured: apiKey !== undefined && Boolean(explicitModel),
    baseUrl:
      explicitBaseUrl ||
      (target === "anthropic"
        ? "https://api.anthropic.com/v1"
        : "https://api.openai.com/v1"),
    model: explicitModel || "",
    apiKey,
    timeoutMs,
  };
}

function timeoutFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal });
}

function optionalSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (typeof error === "object" && error !== null && "errorCode" in error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    if (typeof code === "string" && /^[a-z0-9_]{1,80}$/u.test(code))
      return code;
  }
  return "provider_acceptance_failed";
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function failConfiguration(message: string): never {
  throw new Error(message);
}
