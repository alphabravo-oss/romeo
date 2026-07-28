import {
  createPromptTemplateRoute,
  deletePromptTemplateRoute,
  getPromptTemplateRoute,
  listPromptMarketplaceRoute,
  listPromptTemplateSharesRoute,
  listPromptTemplatesRoute,
  sharePromptTemplateRoute,
  updatePromptTemplateRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerPromptTemplateRoutes(app: RomeoApi): void {
  app.openapi(listPromptTemplatesRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const workspaceId = query.workspaceId;
    const limit = query.limit;
    const offset = query.offset;
    if (limit !== undefined) {
      const page = await context
        .get("services")
        .prompts.listPage(subject, workspaceId, {
          limit,
          offset: offset ?? 0,
          ...(query.query === undefined ? {} : { query: query.query }),
        });
      return context.json({
        data: page.items,
        meta: {
          limit: page.limit,
          offset: page.offset,
          total: page.total,
          hasMore: page.offset + page.items.length < page.total,
        },
      });
    }
    const data = await context
      .get("services")
      .prompts.list(subject, workspaceId, query.query ?? "");
    return context.json({ data });
  });

  app.openapi(createPromptTemplateRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").prompts.create(subject, body);
    return context.json({ data }, 201);
  });

  app.openapi(listPromptMarketplaceRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .prompts.marketplace(subject, query.workspaceId, query.query ?? "");
    return context.json({ data });
  });

  app.openapi(getPromptTemplateRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .prompts.get(subject, context.req.valid("param").promptTemplateId);
    return context.json({ data });
  });

  app.openapi(updatePromptTemplateRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .prompts.update(
        subject,
        context.req.valid("param").promptTemplateId,
        body,
      );
    return context.json({ data });
  });

  app.openapi(deletePromptTemplateRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .prompts.delete(subject, context.req.valid("param").promptTemplateId);
    return context.json({ data });
  });

  app.openapi(listPromptTemplateSharesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .prompts.shares(subject, context.req.valid("param").promptTemplateId);
    return context.json({ data });
  });

  app.openapi(sharePromptTemplateRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").prompts.share({
      subject,
      promptTemplateId: context.req.valid("param").promptTemplateId,
      share: body,
    });
    return context.json({ data }, 201);
  });
}
