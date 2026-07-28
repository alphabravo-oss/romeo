import {
  addOpenWebUiChatTagRoute,
  createOpenWebUiChatRoute,
  createOpenWebUiFolderRoute,
  deleteOpenWebUiChatTagRoute,
  deleteOpenWebUiFolderRoute,
  getOpenWebUiChatPinnedStatusRoute,
  getOpenWebUiFolderRoute,
  listAllOpenWebUiArchivedChatsRoute,
  listOpenWebUiArchivedChatsRoute,
  listOpenWebUiChatsAliasRoute,
  listOpenWebUiChatsByTagRoute,
  listOpenWebUiChatsRoute,
  listOpenWebUiChatTagsRoute,
  listOpenWebUiFolderChatsRoute,
  listOpenWebUiFolderChatSummariesRoute,
  listOpenWebUiFoldersRoute,
  listOpenWebUiPinnedChatsRoute,
  listOpenWebUiTagsRoute,
  searchOpenWebUiChatsRoute,
  toggleOpenWebUiChatPinnedRoute,
  updateOpenWebUiChatFolderRoute,
  updateOpenWebUiFolderExpandedRoute,
  updateOpenWebUiFolderParentRoute,
  updateOpenWebUiFolderRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerOpenWebUiChatRoutes(app: RomeoApi): void {
  app.openapi(listOpenWebUiChatsRoute, async (context) => {
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatList(context.get("subject"), {
        includeFolders: query.include_folders === "true",
        includePinned: query.include_pinned === "true",
        page: query.page ?? null,
      });
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiChatsAliasRoute, async (context) => {
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatList(context.get("subject"), {
        includeFolders: query.include_folders === "true",
        includePinned: query.include_pinned === "true",
        page: query.page ?? null,
      });
    return context.json(data, 200);
  });
  app.openapi(createOpenWebUiChatRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.createChat(
        context.get("subject"),
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiPinnedChatsRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.pinnedChats(context.get("subject"));
    return context.json(data, 200);
  });
  app.openapi(getOpenWebUiChatPinnedStatusRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatPinnedStatus(
        context.get("subject"),
        context.req.valid("param").chatId,
      );
    return context.json(data, 200);
  });
  app.openapi(toggleOpenWebUiChatPinnedRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.toggleChatPinned(
        context.get("subject"),
        context.req.valid("param").chatId,
      );
    return context.json(data, 200);
  });
  app.openapi(searchOpenWebUiChatsRoute, async (context) => {
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .openWebUiCompatibility.searchChats(context.get("subject"), query.text, {
        page: query.page ?? null,
      });
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiArchivedChatsRoute, async (context) => {
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .openWebUiCompatibility.archivedChats(context.get("subject"), {
        page: query.page ?? null,
      });
    return context.json(data, 200);
  });
  app.openapi(listAllOpenWebUiArchivedChatsRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.allArchivedChats(context.get("subject"));
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiTagsRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.allTags(context.get("subject"));
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiChatsByTagRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatsByTag(
        context.get("subject"),
        context.req.valid("json").name,
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiChatTagsRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatTags(
        context.get("subject"),
        context.req.valid("param").chatId,
      );
    return context.json(data, 200);
  });
  app.openapi(addOpenWebUiChatTagRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.addChatTag(
        context.get("subject"),
        context.req.valid("param").chatId,
        context.req.valid("json").name,
      );
    return context.json(data, 200);
  });
  app.openapi(deleteOpenWebUiChatTagRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteChatTag(
        context.get("subject"),
        context.req.valid("param").chatId,
        context.req.valid("json").name,
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiFolderChatsRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatsByFolder(
        context.get("subject"),
        context.req.valid("param").folderId,
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiFolderChatSummariesRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.chatsByFolder(
        context.get("subject"),
        context.req.valid("param").folderId,
        { compact: true, page: context.req.valid("query").page ?? null },
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiChatFolderRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateChatFolder(
        context.get("subject"),
        context.req.valid("param").chatId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(listOpenWebUiFoldersRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.folders(context.get("subject"));
    return context.json(data, 200);
  });
  app.openapi(createOpenWebUiFolderRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.createFolder(
        context.get("subject"),
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(getOpenWebUiFolderRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.folder(
        context.get("subject"),
        context.req.valid("param").folderId,
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiFolderRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateFolder(
        context.get("subject"),
        context.req.valid("param").folderId,
        context.req.valid("json"),
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiFolderExpandedRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateFolderExpanded(
        context.get("subject"),
        context.req.valid("param").folderId,
        context.req.valid("json").is_expanded,
      );
    return context.json(data, 200);
  });
  app.openapi(updateOpenWebUiFolderParentRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.updateFolderParent(
        context.get("subject"),
        context.req.valid("param").folderId,
        context.req.valid("json").parent_id ?? null,
      );
    return context.json(data, 200);
  });
  app.openapi(deleteOpenWebUiFolderRoute, async (context) => {
    const data = await context
      .get("services")
      .openWebUiCompatibility.deleteFolder(
        context.get("subject"),
        context.req.valid("param").folderId,
        context.req.valid("query").delete_contents === "true",
      );
    return context.json(data, 200);
  });
}
