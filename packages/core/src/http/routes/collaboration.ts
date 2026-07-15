import type { RomeoApi } from "../context";
import {
  createFavoriteSchema,
  createFolderItemSchema,
  createFolderSchema,
  shareResourceSchema,
  updateFolderSchema,
} from "../schemas";

export function registerCollaborationRoutes(app: RomeoApi): void {
  app.get("/api/v1/share-targets", async (context) => {
    const subject = context.get("subject");
    const limit = context.req.query("limit");
    const data = await context
      .get("services")
      .collaboration.shareTargets(
        subject,
        context.req.query("query") ?? "",
        limit === undefined ? undefined : Number(limit),
      );
    return context.json({ data });
  });

  app.get("/api/v1/agents/:agentId/shares", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.listAgentShares(subject, context.req.param("agentId"));
    return context.json({ data });
  });

  app.post("/api/v1/agents/:agentId/shares", async (context) => {
    const subject = context.get("subject");
    const body = shareResourceSchema.parse(await context.req.json());
    const data = await context.get("services").collaboration.shareAgent({
      subject,
      agentId: context.req.param("agentId"),
      share: body,
    });
    return context.json({ data }, 201);
  });

  app.get(
    "/api/v1/knowledge-bases/:knowledgeBaseId/shares",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .collaboration.listKnowledgeBaseShares(
          subject,
          context.req.param("knowledgeBaseId"),
        );
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/shares",
    async (context) => {
      const subject = context.get("subject");
      const body = shareResourceSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .collaboration.shareKnowledgeBase({
          subject,
          knowledgeBaseId: context.req.param("knowledgeBaseId"),
          share: body,
        });
      return context.json({ data }, 201);
    },
  );

  app.get("/api/v1/chats/:chatId/shares", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.listChatShares(subject, context.req.param("chatId"));
    return context.json({ data });
  });

  app.post("/api/v1/chats/:chatId/shares", async (context) => {
    const subject = context.get("subject");
    const body = shareResourceSchema.parse(await context.req.json());
    const data = await context.get("services").collaboration.shareChat({
      subject,
      chatId: context.req.param("chatId"),
      share: body,
    });
    return context.json({ data }, 201);
  });

  app.get("/api/v1/files/:fileId/shares", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.listFileShares(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.post("/api/v1/files/:fileId/shares", async (context) => {
    const subject = context.get("subject");
    const body = shareResourceSchema.parse(await context.req.json());
    const data = await context.get("services").collaboration.shareFile({
      subject,
      fileId: context.req.param("fileId"),
      share: body,
    });
    return context.json({ data }, 201);
  });

  app.get("/api/v1/agent-gallery", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.agentGallery(subject, context.req.query("workspaceId"));
    return context.json({ data });
  });

  app.get("/api/v1/favorites", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").collaboration.favorites(subject);
    return context.json({ data });
  });

  app.post("/api/v1/favorites", async (context) => {
    const subject = context.get("subject");
    const body = createFavoriteSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .collaboration.favorite({
        subject,
        resourceType: body.resourceType,
        resourceId: body.resourceId,
      });
    return context.json({ data }, 201);
  });

  app.delete("/api/v1/favorites/:favoriteId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.deleteFavorite(subject, context.req.param("favoriteId"));
    return context.json({ data });
  });

  app.get("/api/v1/folders", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.folders(subject, context.req.query("workspaceId") ?? "");
    return context.json({ data });
  });

  app.post("/api/v1/folders", async (context) => {
    const subject = context.get("subject");
    const body = createFolderSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .collaboration.createFolder({
        subject,
        workspaceId: body.workspaceId,
        name: body.name,
        parentId: body.parentId,
        meta: body.meta,
        data: body.data,
        isExpanded: body.isExpanded,
      });
    return context.json({ data }, 201);
  });

  app.get("/api/v1/folders/:folderId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.folder(subject, context.req.param("folderId"));
    return context.json({ data });
  });

  app.patch("/api/v1/folders/:folderId", async (context) => {
    const subject = context.get("subject");
    const body = updateFolderSchema.parse(await context.req.json());
    const data = await context.get("services").collaboration.updateFolder({
      subject,
      folderId: context.req.param("folderId"),
      name: body.name,
      parentId: body.parentId,
      meta: body.meta,
      data: body.data,
      isExpanded: body.isExpanded,
    });
    return context.json({ data });
  });

  app.delete("/api/v1/folders/:folderId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.deleteFolder(subject, context.req.param("folderId"));
    return context.json({ data });
  });

  app.get("/api/v1/folders/:folderId/shares", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.listFolderShares(subject, context.req.param("folderId"));
    return context.json({ data });
  });

  app.post("/api/v1/folders/:folderId/shares", async (context) => {
    const subject = context.get("subject");
    const body = shareResourceSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .collaboration.shareFolder({
        subject,
        folderId: context.req.param("folderId"),
        share: body,
      });
    return context.json({ data }, 201);
  });

  app.get("/api/v1/folders/:folderId/items", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.folderItems(subject, context.req.param("folderId"));
    return context.json({ data });
  });

  app.post("/api/v1/folders/:folderId/items", async (context) => {
    const subject = context.get("subject");
    const body = createFolderItemSchema.parse(await context.req.json());
    const data = await context.get("services").collaboration.addFolderItem({
      subject,
      folderId: context.req.param("folderId"),
      resourceType: body.resourceType,
      resourceId: body.resourceId,
    });
    return context.json({ data }, 201);
  });

  app.delete("/api/v1/folders/:folderId/items/:itemId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .collaboration.deleteFolderItem(
        subject,
        context.req.param("folderId"),
        context.req.param("itemId"),
      );
    return context.json({ data });
  });
}
