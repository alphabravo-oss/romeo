import type { RomeoApi } from "../context";
import { createWorkspaceSchema } from "../schemas";

export function registerWorkspaceRoutes(app: RomeoApi): void {
  app.post("/api/v1/workspaces", async (context) => {
    const subject = context.get("subject");
    const body = createWorkspaceSchema.parse(await context.req.json());
    const data = await context.get("services").workspace.create({
      subject,
      name: body.name,
      ...(body.slug === undefined ? {} : { slug: body.slug }),
    });
    return context.json({ data }, 201);
  });

  app.post("/api/v1/workspaces/:workspaceId/archive", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .workspace.archive({
        subject,
        workspaceId: context.req.param("workspaceId"),
      });
    return context.json({ data });
  });

  app.get("/api/v1/workspaces/:workspaceId/export", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .workspace.exportWorkspace({
        subject,
        workspaceId: context.req.param("workspaceId"),
      });
    return context.json({ data });
  });
}
