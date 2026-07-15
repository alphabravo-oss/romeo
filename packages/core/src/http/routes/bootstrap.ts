import type { RomeoApi } from "../context";
import { updateMyProfileSchema } from "../schemas";

export function registerBootstrapRoutes(app: RomeoApi): void {
  app.get("/api/v1/me", async (context) => {
    const subject = context.get("subject");
    const services = context.get("services");
    const bootstrap = await services.workspace.bootstrap(subject);
    return context.json({
      subject,
      deployment: { tenancyMode: services.deployment.tenancyMode },
      ...bootstrap,
    });
  });

  app.patch("/api/v1/me", async (context) => {
    const subject = context.get("subject");
    const body = updateMyProfileSchema.parse(await context.req.json());
    const data = await context.get("services").users.updateCurrentProfile({
      subject,
      ...(body.email === undefined ? {} : { email: body.email }),
      ...(body.name === undefined ? {} : { name: body.name }),
    });
    return context.json({ data });
  });

  app.get("/api/v1/organizations", async (context) => {
    const subject = context.get("subject");
    const { organizations } = await context
      .get("services")
      .workspace.bootstrap(subject);
    return context.json({ data: organizations });
  });

  app.get("/api/v1/workspaces", async (context) => {
    const subject = context.get("subject");
    const { workspaces } = await context
      .get("services")
      .workspace.bootstrap(subject);
    return context.json({ data: workspaces });
  });
}
