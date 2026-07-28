import {
  collaborationAddFolderItem,
  collaborationCreateFavorite,
  collaborationCreateFolder,
  collaborationDeleteFolderItem,
  collaborationListFavorites,
  collaborationListFolderItems,
  collaborationListFolders,
  collaborationListShareTargets,
  collaborationShareChat,
  collaborationShareFolder,
  collaborationShareKnowledgeBase,
  managedModelsListGallery,
  managedModelsShare,
  promptsCreateTemplate,
  promptsListMarketplace,
  promptsListTemplates,
  promptsShareTemplate,
  promptsUpdateTemplate,
  type CreateFolderItemRequest,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import { csvFlag, optionalIntegerFlag, requiredFlag } from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface CollaborationCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeCollaborationCommand(
  area: string,
  action: string | undefined,
  context: CollaborationCommandContext,
): Promise<number> | undefined {
  const command = collaborationCommand(area, action, context);
  return command === undefined ? undefined : result(context, command);
}

function collaborationCommand(
  area: string,
  action: string | undefined,
  context: CollaborationCommandContext,
): Promise<unknown> | undefined {
  if (area === "gallery" && action === "agents") return listGallery(context);
  if (area === "favorites" && action === "list") return listFavorites(context);
  if (area === "favorites" && action === "agent") return favoriteAgent(context);
  if (area === "prompts" && action === "list") return listPrompts(context);
  if (area === "prompts" && action === "marketplace")
    return listPromptMarketplace(context);
  if (area === "prompts" && action === "create") return createPrompt(context);
  if (area === "prompts" && action === "update") return updatePrompt(context);
  if (area === "folders" && action === "list") return listFolders(context);
  if (area === "folders" && action === "create") return createFolder(context);
  if (area === "folders" && action === "share") return shareFolder(context);
  if (area === "folders" && action === "items") return listFolderItems(context);
  if (area === "folders" && action === "add-item")
    return addFolderItem(context);
  if (area === "folders" && action === "delete-item")
    return deleteFolderItem(context);
  if (area === "share" && action === "targets")
    return listShareTargets(context);
  if (area === "share" && action === "agent") return shareAgent(context);
  if (area === "share" && action === "chat") return shareChat(context);
  if (area === "share" && action === "kb") return shareKnowledgeBase(context);
  if (area === "share" && action === "prompt") return sharePrompt(context);
  return undefined;
}

function listGallery(context: CollaborationCommandContext) {
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return managedModelsListGallery({
    client: generatedClient(context),
    ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listFavorites(context: CollaborationCommandContext) {
  return collaborationListFavorites({
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function favoriteAgent(context: CollaborationCommandContext) {
  const body = {
    resourceType: "agent" as const,
    resourceId: requiredFlag(context.parsed, "agent", "agent-id"),
  };
  return collaborationCreateFavorite({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function listPrompts(context: CollaborationCommandContext) {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const query = flagValue(context.parsed.flags, "query", "q");
  return promptsListTemplates({
    client: generatedClient(context),
    query: { workspaceId, ...(query === undefined ? {} : { query }) },
    throwOnError: true,
  }).then((response) => response.data.data);
}

function listPromptMarketplace(context: CollaborationCommandContext) {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const query = flagValue(context.parsed.flags, "query", "q");
  return promptsListMarketplace({
    client: generatedClient(context),
    query: { workspaceId, ...(query === undefined ? {} : { query }) },
    throwOnError: true,
  }).then(dataEnvelope);
}

function createPrompt(context: CollaborationCommandContext) {
  const description = flagValue(context.parsed.flags, "description");
  const body = {
    workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
    name: requiredFlag(context.parsed, "name"),
    body: requiredFlag(context.parsed, "body", "prompt"),
    tags: csvFlag(context.parsed, "tag", "tags"),
    visibility: promptVisibility(
      flagValue(context.parsed.flags, "visibility") ?? "private",
    ),
    ...(description === undefined ? {} : { description }),
  };
  return promptsCreateTemplate({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function updatePrompt(context: CollaborationCommandContext) {
  const promptTemplateId = requiredFlag(
    context.parsed,
    "prompt",
    "prompt-template",
  );
  const name = flagValue(context.parsed.flags, "name");
  const bodyValue = flagValue(context.parsed.flags, "body");
  const description = flagValue(context.parsed.flags, "description");
  const visibility = flagValue(context.parsed.flags, "visibility");
  const tags = csvFlag(context.parsed, "tag", "tags");
  const body = {
    ...(name === undefined ? {} : { name }),
    ...(bodyValue === undefined ? {} : { body: bodyValue }),
    ...(description === undefined ? {} : { description }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(visibility === undefined
      ? {}
      : { visibility: promptVisibility(visibility) }),
  };
  return promptsUpdateTemplate({
    body,
    client: generatedClient(context),
    path: { promptTemplateId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function listFolders(context: CollaborationCommandContext) {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  return collaborationListFolders({
    client: generatedClient(context),
    query: { workspaceId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function createFolder(context: CollaborationCommandContext) {
  const body = {
    workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
    name: requiredFlag(context.parsed, "name"),
  };
  return collaborationCreateFolder({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function shareFolder(context: CollaborationCommandContext) {
  const folderId = requiredFlag(context.parsed, "folder", "folder-id");
  const body = shareBody(context, ["read"]);
  return collaborationShareFolder({
    body,
    client: generatedClient(context),
    path: { folderId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function listFolderItems(context: CollaborationCommandContext) {
  const folderId = requiredFlag(context.parsed, "folder", "folder-id");
  return collaborationListFolderItems({
    client: generatedClient(context),
    path: { folderId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function addFolderItem(context: CollaborationCommandContext) {
  const folderId = requiredFlag(context.parsed, "folder", "folder-id");
  const body: CreateFolderItemRequest = {
    resourceType: folderItemResourceType(
      requiredFlag(context.parsed, "type", "resource-type"),
    ),
    resourceId: requiredFlag(context.parsed, "resource", "resource-id"),
  };
  return collaborationAddFolderItem({
    body,
    client: generatedClient(context),
    path: { folderId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function deleteFolderItem(context: CollaborationCommandContext) {
  const folderId = requiredFlag(context.parsed, "folder", "folder-id");
  const itemId = requiredFlag(context.parsed, "item", "item-id");
  return collaborationDeleteFolderItem({
    client: generatedClient(context),
    path: { folderId, itemId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function listShareTargets(context: CollaborationCommandContext) {
  const query = flagValue(context.parsed.flags, "query", "q");
  const limit = optionalIntegerFlag(context.parsed, "limit");
  return collaborationListShareTargets({
    client: generatedClient(context),
    ...(query === undefined && limit === undefined
      ? {}
      : {
          query: {
            ...(query === undefined ? {} : { query }),
            ...(limit === undefined ? {} : { limit }),
          },
        }),
    throwOnError: true,
  }).then(dataEnvelope);
}

function shareAgent(context: CollaborationCommandContext) {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  const body = shareBody(context, ["read", "run"]);
  return managedModelsShare({
    body,
    client: generatedClient(context),
    path: { agentId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function shareChat(context: CollaborationCommandContext) {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  const body = shareBody(context, ["read", "write"]);
  return collaborationShareChat({
    body,
    client: generatedClient(context),
    path: { chatId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function shareKnowledgeBase(context: CollaborationCommandContext) {
  const knowledgeBaseId = requiredFlag(context.parsed, "kb", "knowledge-base");
  const body = shareBody(context, ["read", "use"]);
  return collaborationShareKnowledgeBase({
    body,
    client: generatedClient(context),
    path: { knowledgeBaseId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function sharePrompt(context: CollaborationCommandContext) {
  const promptTemplateId = requiredFlag(
    context.parsed,
    "prompt",
    "prompt-template",
  );
  const body = shareBody(context, ["read", "use"]);
  return promptsShareTemplate({
    body,
    client: generatedClient(context),
    path: { promptTemplateId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(
  context: CollaborationCommandContext,
): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function shareBody<Permission extends "read" | "run" | "use" | "write">(
  context: CollaborationCommandContext,
  permissions: Permission[],
) {
  return {
    principalType: "group" as const,
    principalId: flagValue(context.parsed.flags, "group") ?? "group_reviewers",
    permissions,
  };
}

function folderItemResourceType(
  value: string,
): CreateFolderItemRequest["resourceType"] {
  if (value === "agent" || value === "chat" || value === "knowledge_base")
    return value;
  throw new CliUsageError("--type must be agent, chat, or knowledge_base.");
}

function promptVisibility(
  value: string,
): "marketplace" | "private" | "workspace" {
  if (value === "marketplace" || value === "private" || value === "workspace")
    return value;
  throw new CliUsageError(
    "--visibility must be private, workspace, or marketplace.",
  );
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: CollaborationCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
