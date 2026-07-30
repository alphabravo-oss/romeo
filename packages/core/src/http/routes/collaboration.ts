import {
  addFolderItemRoute,
  createFavoriteRoute,
  createFolderRoute,
  deleteFavoriteRoute,
  deleteFolderItemRoute,
  deleteFolderRoute,
  getFolderRoute,
  listChatSharesRoute,
  listFavoritesRoute,
  listFileSharesRoute,
  listFolderItemsRoute,
  listFolderSharesRoute,
  listFoldersRoute,
  listKnowledgeBaseSharesRoute,
  listManagedModelGalleryRoute,
  listManagedModelGrantsRoute,
  listShareTargetsRoute,
  revokeChatShareRoute,
  revokeManagedModelGrantRoute,
  shareChatRoute,
  shareFileRoute,
  shareFolderRoute,
  shareKnowledgeBaseRoute,
  shareManagedModelRoute,
  updateFolderRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerCollaborationRoutes(app: RomeoApi): void {
  app.openapi(listShareTargetsRoute, async (context) => {
    const { query, limit } = context.req.valid("query");
    const data = await context
      .get("services")
      .collaboration.shareTargets(context.get("subject"), query ?? "", limit);
    return context.json({ data }, 200);
  });

  app.openapi(listManagedModelGrantsRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.listAgentShares(context.get("subject"), agentId);
    return context.json({ data: toManagedModelGrants(data) }, 200);
  });

  app.openapi(shareManagedModelRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const data = await context.get("services").collaboration.shareAgent({
      subject: context.get("subject"),
      agentId,
      share: context.req.valid("json"),
    });
    return context.json({ data: toManagedModelGrants(data) }, 201);
  });

  app.openapi(revokeManagedModelGrantRoute, async (context) => {
    const { agentId, grantId } = context.req.valid("param");
    const data = await context.get("services").collaboration.revokeAgentGrant({
      subject: context.get("subject"),
      agentId,
      grantId,
    });
    return context.json({ data: toManagedModelGrants([data])[0]! }, 200);
  });

  app.openapi(listKnowledgeBaseSharesRoute, async (context) => {
    const { knowledgeBaseId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.listKnowledgeBaseShares(
        context.get("subject"),
        knowledgeBaseId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(shareKnowledgeBaseRoute, async (context) => {
    const { knowledgeBaseId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.shareKnowledgeBase({
        subject: context.get("subject"),
        knowledgeBaseId,
        share: context.req.valid("json"),
      });
    return context.json({ data }, 201);
  });

  app.openapi(listChatSharesRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.listChatShares(context.get("subject"), chatId);
    return context.json({ data }, 200);
  });

  app.openapi(shareChatRoute, async (context) => {
    const { chatId } = context.req.valid("param");
    const data = await context.get("services").collaboration.shareChat({
      subject: context.get("subject"),
      chatId,
      share: context.req.valid("json"),
    });
    return context.json({ data }, 201);
  });

  app.openapi(revokeChatShareRoute, async (context) => {
    const { chatId, grantId } = context.req.valid("param");
    const data = await context.get("services").collaboration.revokeChatShare({
      subject: context.get("subject"),
      chatId,
      grantId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(listFileSharesRoute, async (context) => {
    const { fileId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.listFileShares(context.get("subject"), fileId);
    return context.json({ data }, 200);
  });

  app.openapi(shareFileRoute, async (context) => {
    const { fileId } = context.req.valid("param");
    const data = await context.get("services").collaboration.shareFile({
      subject: context.get("subject"),
      fileId,
      share: context.req.valid("json"),
    });
    return context.json({ data }, 201);
  });

  app.openapi(listManagedModelGalleryRoute, async (context) => {
    const { workspaceId } = context.req.valid("query");
    const data = await context
      .get("services")
      .collaboration.agentGallery(context.get("subject"), workspaceId);
    return context.json({ data }, 200);
  });

  app.openapi(listFavoritesRoute, async (context) => {
    const data = await context
      .get("services")
      .collaboration.favorites(context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(createFavoriteRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context.get("services").collaboration.favorite({
      subject: context.get("subject"),
      ...body,
    });
    return context.json({ data }, 201);
  });

  app.openapi(deleteFavoriteRoute, async (context) => {
    const { favoriteId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.deleteFavorite(context.get("subject"), favoriteId);
    return context.json({ data }, 200);
  });

  app.openapi(listFoldersRoute, async (context) => {
    const { workspaceId } = context.req.valid("query");
    const data = await context
      .get("services")
      .collaboration.folders(context.get("subject"), workspaceId);
    return context.json({ data }, 200);
  });

  app.openapi(createFolderRoute, async (context) => {
    const data = await context.get("services").collaboration.createFolder({
      subject: context.get("subject"),
      ...context.req.valid("json"),
    });
    return context.json({ data }, 201);
  });

  app.openapi(getFolderRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.folder(context.get("subject"), folderId);
    return context.json({ data }, 200);
  });

  app.openapi(updateFolderRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context.get("services").collaboration.updateFolder({
      subject: context.get("subject"),
      folderId,
      ...context.req.valid("json"),
    });
    return context.json({ data }, 200);
  });

  app.openapi(deleteFolderRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.deleteFolder(context.get("subject"), folderId);
    return context.json({ data }, 200);
  });

  app.openapi(listFolderSharesRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.listFolderShares(context.get("subject"), folderId);
    return context.json({ data }, 200);
  });

  app.openapi(shareFolderRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context.get("services").collaboration.shareFolder({
      subject: context.get("subject"),
      folderId,
      share: context.req.valid("json"),
    });
    return context.json({ data }, 201);
  });

  app.openapi(listFolderItemsRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.folderItems(context.get("subject"), folderId);
    return context.json({ data }, 200);
  });

  app.openapi(addFolderItemRoute, async (context) => {
    const { folderId } = context.req.valid("param");
    const data = await context.get("services").collaboration.addFolderItem({
      subject: context.get("subject"),
      folderId,
      ...context.req.valid("json"),
    });
    return context.json({ data }, 201);
  });

  app.openapi(deleteFolderItemRoute, async (context) => {
    const { folderId, itemId } = context.req.valid("param");
    const data = await context
      .get("services")
      .collaboration.deleteFolderItem(context.get("subject"), folderId, itemId);
    return context.json({ data }, 200);
  });
}

function toManagedModelGrants(
  grants: Array<{
    createdAt?: string;
    id: string;
    principalId: string;
    principalType: "group" | "service_account" | "user";
    permission: "read" | "run" | "use" | "write";
    resourceId: string;
    resourceType: string;
  }>,
) {
  return grants
    .filter(
      (
        grant,
      ): grant is typeof grant & { permission: "read" | "run" | "write" } =>
        grant.permission !== "use",
    )
    .map((grant) => ({ ...grant, resourceType: "agent" as const }));
}
