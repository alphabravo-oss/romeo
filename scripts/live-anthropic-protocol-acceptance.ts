import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultProviderCapabilities,
  type ProviderInstance,
  type StreamChatChunk,
} from "../packages/providers/src/index.ts";
import { anthropicAdapter } from "../packages/providers/src/adapters/anthropic.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  repoRoot,
  process.env.ROMEO_ANTHROPIC_PROTOCOL_EVIDENCE_PATH ??
    "dist/evidence/live-anthropic-protocol-acceptance.json",
);
const apiKey = `anthropic_protocol_${randomUUID()}`;
const sentinels = {
  system: `ANTHROPIC_SYSTEM_${randomUUID()}`,
  prompt: `ANTHROPIC_PROMPT_${randomUUID()}`,
  toolResult: `ANTHROPIC_TOOL_RESULT_${randomUUID()}`,
} as const;
const observations = {
  credentialAccepted: true,
  modelDiscoveryRequests: 0,
  messageRequests: 0,
  systemSerialized: false,
  visionSerialized: false,
  toolDefinitionSerialized: false,
  toolUseContinuationSerialized: false,
  toolResultContinuationSerialized: false,
};
const startedAt = performance.now();
const server = await startServer();

try {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Anthropic protocol server did not expose a TCP port.");
  }
  const provider: ProviderInstance = {
    id: "provider_anthropic_protocol",
    orgId: "org_protocol",
    type: "anthropic",
    name: "Controlled Anthropic protocol",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    credentialRef: "env://ANTHROPIC_PROTOCOL_API_KEY",
    enabled: true,
    capabilities: defaultProviderCapabilities("anthropic"),
  };
  const discovered = await anthropicAdapter.listModels(provider, { apiKey });
  const model = discovered[0];
  if (model === undefined || model.name !== "claude-controlled") {
    throw new Error(
      "Anthropic model discovery did not return the controlled model.",
    );
  }

  const firstChunks = await collect(
    anthropicAdapter.streamChat({
      provider,
      model,
      apiKey,
      messages: [
        { role: "system", content: sentinels.system },
        {
          role: "user",
          content: sentinels.prompt,
          images: [
            {
              mimeType: "image/png",
              dataBase64: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
      ],
      tools: [
        {
          name: "lookup_policy",
          description: "Look up a controlled policy",
          parameters: {
            type: "object",
            properties: { topic: { type: "string" } },
            required: ["topic"],
          },
        },
      ],
    }),
  );
  const toolChunk = firstChunks.find(
    (chunk): chunk is Extract<StreamChatChunk, { type: "tool_call" }> =>
      typeof chunk !== "string" && chunk.type === "tool_call",
  );
  if (
    !firstChunks.includes("Checking policy") ||
    toolChunk?.toolCall.providerCallId !== "toolu_controlled_1" ||
    toolChunk.toolCall.name !== "lookup_policy" ||
    toolChunk.toolCall.arguments.topic !== "retention"
  ) {
    throw new Error("Anthropic text or tool-use stream normalization failed.");
  }
  assertUsage(firstChunks, 12, 5, 17);

  const secondChunks = await collect(
    anthropicAdapter.streamChat({
      provider,
      model,
      apiKey,
      messages: [
        { role: "user", content: sentinels.prompt },
        {
          role: "assistant",
          content: "Checking policy",
          toolCalls: [toolChunk.toolCall],
        },
        {
          role: "tool",
          content: sentinels.toolResult,
          toolCallId: toolChunk.toolCall.providerCallId,
        },
      ],
    }),
  );
  if (!secondChunks.includes("Policy confirmed")) {
    throw new Error("Anthropic tool-result continuation did not stream text.");
  }
  assertUsage(secondChunks, 18, 4, 22);

  if (
    !observations.credentialAccepted ||
    observations.modelDiscoveryRequests !== 1 ||
    observations.messageRequests !== 2 ||
    !observations.systemSerialized ||
    !observations.visionSerialized ||
    !observations.toolDefinitionSerialized ||
    !observations.toolUseContinuationSerialized ||
    !observations.toolResultContinuationSerialized
  ) {
    throw new Error(
      "Anthropic HTTP serialization observations were incomplete.",
    );
  }

  await writeEvidence("passed", {
    modelDiscoveryCount: discovered.length,
    firstStreamChunkCount: firstChunks.length,
    continuationStreamChunkCount: secondChunks.length,
  });
  console.log("Live controlled Anthropic protocol acceptance passed.");
  console.log(`Wrote Anthropic protocol evidence to ${outputPath}`);
} catch (error) {
  await writeEvidence("failed", undefined, error);
  throw error;
} finally {
  await closeServer(server);
}

async function startServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    try {
      if (!headersAccepted(request)) {
        observations.credentialAccepted = false;
        response.statusCode = 401;
        response.end();
        return;
      }
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.method === "GET" && pathname === "/v1/models") {
        observations.modelDiscoveryRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ data: [{ id: "claude-controlled" }] }));
        return;
      }
      if (request.method !== "POST" || pathname !== "/v1/messages") {
        response.statusCode = 404;
        response.end();
        return;
      }
      observations.messageRequests += 1;
      const payload = JSON.parse(await readBody(request)) as Record<
        string,
        unknown
      >;
      if (observations.messageRequests === 1) {
        inspectFirstRequest(payload);
        writeEvents(response, firstEvents());
        return;
      }
      inspectContinuationRequest(payload);
      writeEvents(response, continuationEvents());
    } catch {
      response.statusCode = 400;
      response.end();
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  return server;
}

function headersAccepted(request: IncomingMessage): boolean {
  return (
    request.headers["x-api-key"] === apiKey &&
    request.headers["anthropic-version"] === "2023-06-01"
  );
}

function inspectFirstRequest(payload: Record<string, unknown>): void {
  observations.systemSerialized = payload.system === sentinels.system;
  const messages = arrayRecords(payload.messages);
  const content = arrayRecords(messages[0]?.content);
  const image = record(content.find((item) => item.type === "image"));
  const source = record(image?.source);
  observations.visionSerialized =
    source?.type === "base64" &&
    source.media_type === "image/png" &&
    source.data === "aGVsbG8=";
  const tools = arrayRecords(payload.tools);
  const tool = tools[0];
  observations.toolDefinitionSerialized =
    tool?.name === "lookup_policy" &&
    record(tool.input_schema)?.type === "object";
}

function inspectContinuationRequest(payload: Record<string, unknown>): void {
  const messages = arrayRecords(payload.messages);
  const assistant = messages.find((message) => message.role === "assistant");
  const assistantContent = arrayRecords(assistant?.content);
  const toolUse = assistantContent.find((item) => item.type === "tool_use");
  observations.toolUseContinuationSerialized =
    toolUse?.id === "toolu_controlled_1" &&
    toolUse.name === "lookup_policy" &&
    record(toolUse.input)?.topic === "retention";
  const toolResultMessage = messages.find((message) => {
    const content = arrayRecords(message.content);
    return content.some((item) => item.type === "tool_result");
  });
  const toolResult = arrayRecords(toolResultMessage?.content).find(
    (item) => item.type === "tool_result",
  );
  observations.toolResultContinuationSerialized =
    toolResult?.tool_use_id === "toolu_controlled_1" &&
    toolResult.content === sentinels.toolResult;
}

function firstEvents(): Record<string, unknown>[] {
  return [
    { type: "message_start", message: { usage: { input_tokens: 12 } } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Checking policy" },
    },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "toolu_controlled_1",
        name: "lookup_policy",
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: {
        type: "input_json_delta",
        partial_json: '{"topic":"retention"}',
      },
    },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", usage: { output_tokens: 5 } },
  ];
}

function continuationEvents(): Record<string, unknown>[] {
  return [
    { type: "message_start", message: { usage: { input_tokens: 18 } } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Policy confirmed" },
    },
    { type: "message_delta", usage: { output_tokens: 4 } },
  ];
}

function writeEvents(
  response: ServerResponse,
  events: Record<string, unknown>[],
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
  });
  for (const event of events) {
    response.write(`event: ${String(event.type)}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

async function collect(
  stream: AsyncIterable<StreamChatChunk>,
): Promise<StreamChatChunk[]> {
  const chunks: StreamChatChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function assertUsage(
  chunks: StreamChatChunk[],
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
): void {
  if (
    !chunks.some(
      (chunk) =>
        typeof chunk !== "string" &&
        chunk.type === "usage" &&
        chunk.usage.inputTokens === inputTokens &&
        chunk.usage.outputTokens === outputTokens &&
        chunk.usage.totalTokens === totalTokens &&
        chunk.usage.source === "anthropic",
    )
  ) {
    throw new Error("Anthropic usage normalization was incomplete.");
  }
}

async function writeEvidence(
  status: "failed" | "passed",
  result?: {
    modelDiscoveryCount: number;
    firstStreamChunkCount: number;
    continuationStreamChunkCount: number;
  },
  error?: unknown,
): Promise<void> {
  const evidence = {
    schemaVersion: "romeo.live-anthropic-protocol-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      protocol: "anthropic-v1-messages",
      transport: "http-sse",
      controlledLoopback: true,
    },
    checks: observations,
    ...(result === undefined ? {} : { observations: result }),
    redaction: {
      apiKeyReturned: false,
      endpointReturned: false,
      systemPromptReturned: false,
      userPromptReturned: false,
      imageBodyReturned: false,
      toolResultReturned: false,
      responseTextReturned: false,
      providerPayloadsReturned: false,
    },
    ...(error === undefined
      ? {}
      : {
          failureCode:
            error instanceof Error
              ? createHash("sha256")
                  .update(error.message)
                  .digest("hex")
                  .slice(0, 16)
              : "unknown",
        }),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const result = record(item);
        return result === undefined ? [] : [result];
      })
    : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}
