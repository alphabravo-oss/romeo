import {
  createMemoryRoute,
  createNoteRoute,
  deleteMemoryRoute,
  deleteNoteRoute,
  listMemoriesRoute,
  listNotesRoute,
  updateMemoryRoute,
  updateNoteRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import type {
  CreateWorkspaceContentInput,
  UpdateWorkspaceContentInput,
} from "../../services/workspace-content-service";

export function registerWorkspaceContentRoutes(app: RomeoApi): void {
  app.openapi(listMemoriesRoute, async (context) => {
    const query = context.req.valid("query");
    if (query.limit !== undefined) {
      const page = await context
        .get("services")
        .workspaceContent.listPage(context.get("subject"), "memory", {
          workspaceId: query.workspaceId,
          limit: query.limit,
          offset: query.offset ?? 0,
          ...(query.q === undefined ? {} : { query: query.q }),
        });
      return context.json({ data: page.items, meta: pageMeta(page) }, 200);
    }
    const data = await context
      .get("services")
      .workspaceContent.list(
        context.get("subject"),
        "memory",
        query.workspaceId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(listNotesRoute, async (context) => {
    const query = context.req.valid("query");
    if (query.limit !== undefined) {
      const page = await context
        .get("services")
        .workspaceContent.listPage(context.get("subject"), "note", {
          workspaceId: query.workspaceId,
          limit: query.limit,
          offset: query.offset ?? 0,
          ...(query.q === undefined ? {} : { query: query.q }),
        });
      return context.json({ data: page.items, meta: pageMeta(page) }, 200);
    }
    const data = await context
      .get("services")
      .workspaceContent.list(context.get("subject"), "note", query.workspaceId);
    return context.json({ data }, 200);
  });

  app.openapi(createMemoryRoute, async (context) => {
    const data = await context
      .get("services")
      .workspaceContent.create(
        context.get("subject"),
        "memory",
        createInput(context.req.valid("json")),
      );
    return context.json({ data }, 201);
  });
  app.openapi(createNoteRoute, async (context) => {
    const data = await context
      .get("services")
      .workspaceContent.create(
        context.get("subject"),
        "note",
        createInput(context.req.valid("json")),
      );
    return context.json({ data }, 201);
  });

  app.openapi(updateMemoryRoute, async (context) => {
    const { contentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .workspaceContent.update(
        context.get("subject"),
        "memory",
        contentId,
        updateInput(context.req.valid("json")),
      );
    return context.json({ data }, 200);
  });
  app.openapi(updateNoteRoute, async (context) => {
    const { contentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .workspaceContent.update(
        context.get("subject"),
        "note",
        contentId,
        updateInput(context.req.valid("json")),
      );
    return context.json({ data }, 200);
  });

  app.openapi(deleteMemoryRoute, async (context) => {
    const { contentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .workspaceContent.delete(context.get("subject"), "memory", contentId);
    return context.json({ data }, 200);
  });
  app.openapi(deleteNoteRoute, async (context) => {
    const { contentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .workspaceContent.delete(context.get("subject"), "note", contentId);
    return context.json({ data }, 200);
  });
}

function pageMeta(page: {
  items: unknown[];
  limit: number;
  offset: number;
  total: number;
}) {
  return {
    limit: page.limit,
    offset: page.offset,
    total: page.total,
    hasMore: page.offset + page.items.length < page.total,
  };
}

function createInput(body: {
  workspaceId: string;
  scope: "personal" | "workspace";
  title: string;
  body: string;
  enabled?: boolean | undefined;
  pinned?: boolean | undefined;
  expiresAt?: string | undefined;
}): CreateWorkspaceContentInput {
  return {
    workspaceId: body.workspaceId,
    scope: body.scope,
    title: body.title,
    body: body.body,
    ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
    ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
  };
}

function updateInput(body: {
  scope?: "personal" | "workspace" | undefined;
  title?: string | undefined;
  body?: string | undefined;
  enabled?: boolean | undefined;
  pinned?: boolean | undefined;
  expiresAt?: string | null | undefined;
}): UpdateWorkspaceContentInput {
  return {
    ...(body.scope === undefined ? {} : { scope: body.scope }),
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.body === undefined ? {} : { body: body.body }),
    ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
    ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
  };
}
