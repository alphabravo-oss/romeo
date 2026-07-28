import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { anthropicAdapter } from "../packages/providers/src/adapters/anthropic.ts";
import {
  defaultProviderCapabilities,
  type ProviderInstance,
  type ProviderTokenUsage,
  type StreamChatChunk,
} from "../packages/providers/src/index.ts";

type Status = "failed" | "not_configured" | "passed";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  repoRoot,
  process.env.ROMEO_LIVE_ANTHROPIC_EVIDENCE_PATH ??
    "dist/evidence/live-anthropic-credentialed-acceptance.json",
);
const baseUrl =
  process.env.ROMEO_LIVE_ANTHROPIC_BASE_URL?.trim() ||
  "https://api.anthropic.com/v1";
const modelName = process.env.ROMEO_LIVE_ANTHROPIC_MODEL?.trim();
const apiKey =
  process.env.ROMEO_LIVE_ANTHROPIC_API_KEY?.trim() ||
  process.env.ANTHROPIC_API_KEY?.trim();
const timeoutMs = positiveInteger(
  process.env.ROMEO_LIVE_ANTHROPIC_TIMEOUT_MS,
  120_000,
);
const startedAt = performance.now();

if (!modelName || !apiKey) {
  await writeEvidence({
    status: "not_configured",
    checks: emptyChecks(),
    failureCode: "live_anthropic_configuration_missing",
  });
  console.log(`Wrote not-configured Anthropic evidence to ${outputPath}`);
} else {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const provider: ProviderInstance = {
      id: "provider_anthropic_credentialed",
      orgId: "org_credentialed_acceptance",
      type: "anthropic",
      name: "Credentialed Anthropic acceptance",
      baseUrl,
      credentialRef: "env://ANTHROPIC_API_KEY",
      enabled: true,
      capabilities: defaultProviderCapabilities("anthropic"),
    };
    const discovered = await anthropicAdapter.listModels(provider, {
      apiKey,
      fetchImpl: timeoutFetch(controller.signal),
    });
    const model = discovered.find((candidate) => candidate.name === modelName);
    if (model === undefined) {
      throw codedError("live_anthropic_model_not_discovered");
    }
    const first = await collect(
      anthropicAdapter.streamChat({
        provider,
        model,
        apiKey,
        fetchImpl: timeoutFetch(controller.signal),
        signal: controller.signal,
        messages: [
          {
            role: "system",
            content:
              "Follow the tool instruction exactly and keep the final answer short.",
          },
          {
            role: "user",
            content:
              "Inspect this image, then call inspect_context exactly once with topic set to retention. Do not answer before calling the tool.",
            images: [
              {
                mimeType: "image/png",
                dataBase64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJkAAAAASUVORK5CYII=",
              },
            ],
          },
        ],
        tools: [
          {
            name: "inspect_context",
            description: "Return controlled retention context.",
            parameters: {
              type: "object",
              properties: { topic: { type: "string" } },
              required: ["topic"],
              additionalProperties: false,
            },
          },
        ],
      }),
    );
    const toolCall = first.find(
      (chunk): chunk is Extract<StreamChatChunk, { type: "tool_call" }> =>
        typeof chunk !== "string" && chunk.type === "tool_call",
    )?.toolCall;
    if (
      toolCall === undefined ||
      toolCall.name !== "inspect_context" ||
      toolCall.arguments.topic !== "retention"
    ) {
      throw codedError("live_anthropic_tool_call_missing");
    }
    const firstUsage = finalUsage(first);
    if (textContent(first).length === 0) {
      throw codedError("live_anthropic_initial_text_missing");
    }
    if (firstUsage === undefined) {
      throw codedError("live_anthropic_initial_usage_missing");
    }
    const continuation = await collect(
      anthropicAdapter.streamChat({
        provider,
        model,
        apiKey,
        fetchImpl: timeoutFetch(controller.signal),
        signal: controller.signal,
        messages: [
          {
            role: "user",
            content:
              "Inspect this image, then call inspect_context exactly once with topic set to retention.",
          },
          {
            role: "assistant",
            content: textContent(first),
            toolCalls: [toolCall],
          },
          {
            role: "tool",
            toolCallId: toolCall.providerCallId,
            content:
              "Retention context is available and the controlled tool completed successfully.",
          },
        ],
      }),
    );
    const continuationText = textContent(continuation);
    const continuationUsage = finalUsage(continuation);
    if (continuationText.length === 0) {
      throw codedError("live_anthropic_continuation_text_missing");
    }
    if (continuationUsage === undefined) {
      throw codedError("live_anthropic_continuation_usage_missing");
    }
    await writeEvidence({
      status: "passed",
      checks: {
        modelDiscovered: true,
        textStreamed: textContent(first).length > 0,
        usageReceived: true,
        visionAccepted: true,
        toolUseReceived: true,
        toolResultContinuationCompleted: true,
      },
      observations: {
        discoveredModelCount: discovered.length,
        initialChunkCount: first.length,
        continuationChunkCount: continuation.length,
        ...(firstUsage.totalTokens === undefined
          ? {}
          : { initialTotalTokens: firstUsage.totalTokens }),
        ...(continuationUsage.totalTokens === undefined
          ? {}
          : { continuationTotalTokens: continuationUsage.totalTokens }),
        modelHash: shortHash(model.name),
      },
    });
    console.log("Credentialed Anthropic vision/tool acceptance passed.");
    console.log(`Wrote credentialed Anthropic evidence to ${outputPath}`);
  } catch (error) {
    await writeEvidence({
      status: "failed",
      checks: emptyChecks(),
      failureCode: safeErrorCode(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function collect(
  stream: AsyncIterable<StreamChatChunk>,
): Promise<StreamChatChunk[]> {
  const chunks: StreamChatChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function textContent(chunks: StreamChatChunk[]): string {
  return chunks
    .filter((chunk): chunk is string => typeof chunk === "string")
    .join("");
}

function finalUsage(chunks: StreamChatChunk[]): ProviderTokenUsage | undefined {
  return chunks
    .flatMap((chunk) =>
      typeof chunk !== "string" && chunk.type === "usage" ? [chunk.usage] : [],
    )
    .at(-1);
}

function timeoutFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal });
}

function emptyChecks() {
  return {
    modelDiscovered: false,
    textStreamed: false,
    usageReceived: false,
    visionAccepted: false,
    toolUseReceived: false,
    toolResultContinuationCompleted: false,
  };
}

async function writeEvidence(input: {
  status: Status;
  checks: ReturnType<typeof emptyChecks>;
  observations?: {
    discoveredModelCount: number;
    initialChunkCount: number;
    continuationChunkCount: number;
    initialTotalTokens?: number;
    continuationTotalTokens?: number;
    modelHash: string;
  };
  failureCode?: string;
}): Promise<void> {
  const evidence = {
    schemaVersion: "romeo.live-anthropic-credentialed-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status: input.status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      providerProtocol: "anthropic-v1-messages",
      configured: input.status !== "not_configured",
    },
    checks: input.checks,
    ...(input.observations === undefined
      ? {}
      : { observations: input.observations }),
    redaction: {
      endpointReturned: false,
      apiKeyReturned: false,
      modelNameReturned: false,
      promptsReturned: false,
      imageBodyReturned: false,
      toolArgumentsReturned: false,
      toolResultReturned: false,
      responseTextReturned: false,
      providerPayloadReturned: false,
    },
    ...(input.failureCode === undefined
      ? {}
      : { failureCode: input.failureCode }),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (typeof error === "object" && error !== null && "errorCode" in error) {
    const value = (error as { errorCode?: unknown }).errorCode;
    if (typeof value === "string" && /^[a-z0-9_]{1,80}$/u.test(value)) {
      return value;
    }
  }
  return "live_anthropic_acceptance_failed";
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
