import {
  archiveWorkspaceRoute,
  createWorkspaceRoute,
  exportWorkspaceRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerWorkspaceRoutes(app: RomeoApi): void {
  app.openapi(createWorkspaceRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").workspace.create({
      subject,
      name: body.name,
      ...(body.slug === undefined ? {} : { slug: body.slug }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(archiveWorkspaceRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").workspace.archive({
      subject,
      workspaceId: context.req.valid("param").workspaceId,
    });
    return context.json({ data });
  });

  app.openapi(exportWorkspaceRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").workspace.exportWorkspace({
      subject,
      workspaceId: context.req.valid("param").workspaceId,
    });
    return context.json({ data });
  });
}
