import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultProviderCapabilities,
  getProviderAdapter,
  type BaseModel,
  type ProviderToolCallRequest,
  type ProviderTokenUsage,
  type StreamChatChunk,
} from "../packages/providers/src/index";

const baseUrl =
  process.env.ROMEO_OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
const toolLessModelName =
  process.env.ROMEO_OLLAMA_TOOLLESS_MODEL?.trim() || "gemma:2b";
const toolModelName =
  process.env.ROMEO_OLLAMA_TOOL_MODEL?.trim() || "qwen2.5:1.5b";
const visionModelName =
  process.env.ROMEO_OLLAMA_VISION_MODEL?.trim() || "gemma3:4b";
const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  process.env.ROMEO_OLLAMA_EVIDENCE_PATH ??
    "dist/evidence/live-ollama-acceptance.json",
);
const adapter = getProviderAdapter("ollama");
const provider = {
  id: "live_ollama",
  orgId: "live_acceptance",
  type: "ollama" as const,
  name: "Live Ollama",
  baseUrl,
  enabled: true,
  capabilities: defaultProviderCapabilities("ollama"),
};
const startedAt = performance.now();
const evidence: Record<string, unknown> = {
  schemaVersion: "romeo.live-ollama-acceptance.v1",
  generatedAt: new Date().toISOString(),
  baseUrlOrigin: safeOrigin(baseUrl),
  models: {
    toolLess: toolLessModelName,
    tool: toolModelName,
    vision: visionModelName,
  },
  status: "failed",
};

try {
  const health = await adapter.health(provider);
  assert(health.ok, "health_failed");
  const models = await adapter.listModels(provider);
  const toolLessModel = requiredModel(models, toolLessModelName);
  const toolModel = requiredModel(models, toolModelName);
  const visionModel = requiredModel(models, visionModelName);
  assert(
    !toolLessModel.capabilities.toolCalling,
    "tool_less_capability_incorrect",
  );
  assert(toolModel.capabilities.toolCalling, "tool_capability_missing");
  assert(visionModel.capabilities.vision, "vision_capability_missing");
  const embeddingModels = models.filter((model) => /embed/iu.test(model.name));
  assert(embeddingModels.length > 0, "embedding_model_not_discovered");
  assert(
    embeddingModels.every(
      (model) =>
        !model.enabled && model.capabilities.modalities.includes("embeddings"),
    ),
    "embedding_only_model_not_classified",
  );
  evidence.capabilityDiscovery = {
    discoveredModelCount: models.length,
    embeddingOnlyDiscovered: embeddingModels.length,
    embeddingOnlyExcludedFromChat: true,
    toolLess: true,
    tool: true,
    vision: true,
  };

  const toolLess = await collect(
    adapter.streamChat({
      provider,
      model: toolLessModel,
      messages: [
        { role: "user", content: "Reply with exactly ROMEO_TOOLLESS_OK" },
      ],
    }),
  );
  assert(toolLess.textLength > 0, "tool_less_empty_stream");
  assert(toolLess.toolCalls.length === 0, "tool_less_unexpected_tool_call");
  evidence.toolCapabilityGating = {
    passed: true,
    receivedUsage: toolLess.usage !== undefined,
  };

  const toolDefinition = {
    name: "tool_calculator",
    description: "Evaluate an arithmetic expression.",
    parameters: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
      additionalProperties: false,
    },
  };
  const toolRequest = await collect(
    adapter.streamChat({
      provider,
      model: toolModel,
      messages: [
        {
          role: "user",
          content:
            "Call tool_calculator with expression 2+2. Do not calculate it yourself.",
        },
      ],
      tools: [toolDefinition],
    }),
  );
  const toolCall = toolRequest.toolCalls.find(
    (call) => call.name === toolDefinition.name,
  );
  assert(toolCall !== undefined, "tool_call_missing");
  const continuation = await collect(
    adapter.streamChat({
      provider,
      model: toolModel,
      messages: [
        {
          role: "user",
          content:
            "Call tool_calculator with expression 2+2. Do not calculate it yourself.",
        },
        { role: "assistant", content: "", toolCalls: [toolCall] },
        {
          role: "tool",
          content: "4",
          name: toolDefinition.name,
          toolCallId: toolCall.providerCallId,
        },
      ],
    }),
  );
  assert(continuation.textLength > 0, "tool_continuation_empty");
  evidence.toolCalls = {
    passed: true,
    continuationPassed: true,
    argumentKeys: toolCall.argumentKeys,
    receivedUsage:
      toolRequest.usage !== undefined || continuation.usage !== undefined,
  };

  const vision = await collect(
    adapter.streamChat({
      provider,
      model: visionModel,
      messages: [
        {
          role: "user",
          content: "Describe this image in one short sentence.",
          images: [
            {
              mimeType: "image/png",
              dataBase64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Jm8AAAAASUVORK5CYII=",
            },
          ],
        },
      ],
    }),
  );
  assert(vision.textLength > 0, "vision_empty_stream");
  evidence.vision = {
    passed: true,
    receivedUsage: vision.usage !== undefined,
  };

  const timeoutController = new AbortController();
  const abortTimer = setTimeout(() => timeoutController.abort(), 10);
  let timeoutObserved = false;
  try {
    await collect(
      adapter.streamChat({
        provider,
        model: toolLessModel,
        messages: [{ role: "user", content: "Write a long essay." }],
        signal: timeoutController.signal,
      }),
    );
  } catch (error) {
    timeoutObserved = error instanceof Error && error.name === "AbortError";
  } finally {
    clearTimeout(abortTimer);
  }
  assert(timeoutObserved, "timeout_not_observed");
  const reconnect = await collect(
    adapter.streamChat({
      provider,
      model: toolLessModel,
      messages: [
        { role: "user", content: "Reply with exactly ROMEO_RECONNECT_OK" },
      ],
    }),
  );
  assert(reconnect.textLength > 0, "reconnect_empty_stream");
  evidence.timeoutAndReconnect = {
    timeoutObserved: true,
    reconnectPassed: true,
    receivedUsage: reconnect.usage !== undefined,
  };

  const openAiAdapter = getProviderAdapter("openai-compatible");
  const openAiProvider = {
    ...provider,
    id: "live_openai_compatible_ollama",
    type: "openai-compatible" as const,
    name: "Live OpenAI-compatible Ollama",
    baseUrl: `${new URL(baseUrl).origin}/v1`,
    capabilities: defaultProviderCapabilities("openai-compatible"),
  };
  const openAiToolModel = compatibleModel(openAiProvider.id, toolModelName, {
    toolCalling: true,
    vision: false,
  });
  const openAiToolRequest = await collect(
    openAiAdapter.streamChat({
      provider: openAiProvider,
      model: openAiToolModel,
      apiKey: "ollama-local",
      messages: [
        {
          role: "user",
          content:
            "Call tool_calculator with expression 3+4. Do not calculate it yourself.",
        },
      ],
      tools: [toolDefinition],
    }),
  );
  const openAiToolCall = openAiToolRequest.toolCalls.find(
    (call) => call.name === toolDefinition.name,
  );
  assert(openAiToolCall !== undefined, "openai_compatible_tool_call_missing");
  const openAiContinuation = await collect(
    openAiAdapter.streamChat({
      provider: openAiProvider,
      model: openAiToolModel,
      apiKey: "ollama-local",
      messages: [
        {
          role: "user",
          content:
            "Call tool_calculator with expression 3+4. Do not calculate it yourself.",
        },
        { role: "assistant", content: "", toolCalls: [openAiToolCall] },
        {
          role: "tool",
          content: "7",
          name: toolDefinition.name,
          toolCallId: openAiToolCall.providerCallId,
        },
      ],
    }),
  );
  assert(
    openAiContinuation.textLength > 0,
    "openai_compatible_tool_continuation_empty",
  );
  const openAiVision = await collect(
    openAiAdapter.streamChat({
      provider: openAiProvider,
      model: compatibleModel(openAiProvider.id, visionModelName, {
        toolCalling: false,
        vision: true,
      }),
      apiKey: "ollama-local",
      messages: [
        {
          role: "user",
          content: "Describe this image in one short sentence.",
          images: [
            {
              mimeType: "image/png",
              dataBase64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Jm8AAAAASUVORK5CYII=",
            },
          ],
        },
      ],
    }),
  );
  assert(openAiVision.textLength > 0, "openai_compatible_vision_empty");
  evidence.openAiCompatible = {
    toolCallPassed: true,
    toolContinuationPassed: true,
    visionPassed: true,
    receivedUsage:
      openAiToolRequest.usage !== undefined ||
      openAiContinuation.usage !== undefined ||
      openAiVision.usage !== undefined,
  };

  evidence.durationMs = Math.round(performance.now() - startedAt);
  evidence.status = "passed";
} catch (error) {
  evidence.durationMs = Math.round(performance.now() - startedAt);
  evidence.errorCode = safeErrorCode(error);
  process.exitCode = 1;
} finally {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Ollama live acceptance: ${evidence.status}`);
  console.log(`Wrote redaction-safe evidence to ${outputPath}`);
}

function requiredModel(models: BaseModel[], name: string): BaseModel {
  const model = models.find((candidate) => candidate.name === name);
  if (model === undefined) throw codedError("required_model_not_found");
  return model;
}

function compatibleModel(
  providerId: string,
  name: string,
  capabilities: { toolCalling: boolean; vision: boolean },
): BaseModel {
  return {
    id: `live_${name.replace(/[^a-z0-9]+/giu, "_")}`,
    providerId,
    name,
    displayName: name,
    enabled: true,
    contextWindow: 8_192,
    capabilities: {
      ...defaultProviderCapabilities("openai-compatible"),
      toolCalling: capabilities.toolCalling,
      vision: capabilities.vision,
      modalities: capabilities.vision ? ["text", "vision"] : ["text"],
    },
  };
}

async function collect(stream: AsyncIterable<StreamChatChunk>): Promise<{
  textLength: number;
  toolCalls: ProviderToolCallRequest[];
  usage?: ProviderTokenUsage;
}> {
  let textLength = 0;
  const toolCalls: ProviderToolCallRequest[] = [];
  let usage: ProviderTokenUsage | undefined;
  for await (const chunk of stream) {
    if (typeof chunk === "string") textLength += chunk.length;
    else if (chunk.type === "usage") usage = chunk.usage;
    else toolCalls.push(...(chunk.toolCalls ?? [chunk.toolCall]));
  }
  return { textLength, toolCalls, ...(usage === undefined ? {} : { usage }) };
}

function assert(condition: boolean, errorCode: string): asserts condition {
  if (!condition) throw codedError(errorCode);
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "errorCode" in error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    if (typeof code === "string" && /^[a-z0-9_]{1,80}$/u.test(code))
      return code;
  }
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "ollama_live_acceptance_failed";
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
