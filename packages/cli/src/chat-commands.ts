import {
  chatsArchive,
  chatsCreate,
  chatsCreateComment,
  chatsListComments,
  chatsUpdateLegalHold,
  runsStart,
  runsStreamEvents,
  type UpdateChatLegalHoldRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import { requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson, writeLine } from "./io";

interface ChatCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeChatCommand(
  area: string,
  action: string | undefined,
  context: ChatCommandContext,
): Promise<number> | undefined {
  if (area === "comments" && action === "list")
    return result(context, listComments(context));
  if (area === "comments" && action === "create")
    return result(context, createComment(context));
  if (area === "chat" && action === "archive")
    return result(context, archiveChat(context));
  if (area === "chat" && action === "legal-hold")
    return result(context, updateLegalHold(context));
  if (area === "chat" && action === "legal-hold-clear")
    return result(context, clearLegalHold(context));
  if (area === "chat" && action === "run") return runChat(context);
  return undefined;
}

async function runChat(context: ChatCommandContext): Promise<number> {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  const prompt =
    flagValue(context.parsed.flags, "prompt") ??
    context.parsed.positionals.slice(2).join(" ");
  if (prompt.length === 0)
    throw new CliUsageError("Missing --prompt or prompt text.");

  const title = flagValue(context.parsed.flags, "title") ?? prompt.slice(0, 60);
  const { chat, run, stream } = await startChatRun(context, {
    agentId,
    prompt,
    title,
    workspaceId,
  });
  const events: unknown[] = [];
  for await (const event of stream) {
    events.push(event);
    if (
      !hasFlag(context.parsed.flags, "json") &&
      event.type === "message.delta" &&
      isTextDelta(event.data)
    ) {
      context.io.stdout.write(event.data.text);
    }
  }

  if (hasFlag(context.parsed.flags, "json"))
    writeJson(context.io, { chat, run, events });
  else writeLine(context.io, "");
  return 0;
}

async function startChatRun(
  context: ChatCommandContext,
  input: {
    agentId: string;
    prompt: string;
    title: string;
    workspaceId: string;
  },
) {
  const client = generatedClient(context);
  const chatResponse = await chatsCreate({
    body: { workspaceId: input.workspaceId, title: input.title },
    client,
    throwOnError: true,
  });
  const chat = chatResponse.data.data;
  const runResponse = await runsStart({
    body: {
      chatId: chat.id,
      agentId: input.agentId,
      content: input.prompt,
    },
    client,
    throwOnError: true,
  });
  const run = runResponse.data.data;
  const events = await runsStreamEvents({
    client,
    headers: { accept: "text/event-stream" },
    path: { runId: run.id },
    sseMaxRetryAttempts: 1,
  });
  return { chat, run, stream: events.stream };
}

function listComments(context: ChatCommandContext) {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  return chatsListComments({
    client: generatedClient(context),
    path: { chatId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

function createComment(context: ChatCommandContext) {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  const body = { body: requiredFlag(context.parsed, "body") };
  return chatsCreateComment({
    body,
    client: generatedClient(context),
    path: { chatId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

function archiveChat(context: ChatCommandContext) {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  return chatsArchive({
    client: generatedClient(context),
    path: { chatId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

function updateLegalHold(context: ChatCommandContext) {
  const reason = flagValue(context.parsed.flags, "reason");
  return setLegalHold(context, {
    legalHoldUntil: requiredFlag(context.parsed, "until"),
    ...(reason === undefined ? {} : { legalHoldReason: reason }),
  });
}

function clearLegalHold(context: ChatCommandContext) {
  return setLegalHold(context, { legalHoldUntil: null });
}

function setLegalHold(
  context: ChatCommandContext,
  body: UpdateChatLegalHoldRequest,
) {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  return chatsUpdateLegalHold({
    body,
    client: generatedClient(context),
    path: { chatId },
    throwOnError: true,
  }).then((response) => response.data.data);
}

function generatedClient(context: ChatCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

async function result(
  context: ChatCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}

function isTextDelta(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}
