import {
  getCurrentPrincipalRoute,
  listOrganizationsRoute,
  listWorkspacesRoute,
  updateCurrentProfileRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerBootstrapRoutes(app: RomeoApi): void {
  app.openapi(getCurrentPrincipalRoute, async (context) => {
    const subject = context.get("subject");
    const services = context.get("services");
    const bootstrap = await services.workspace.bootstrap(subject);
    return context.json(
      {
        subject,
        deployment: { tenancyMode: services.deployment.tenancyMode },
        ...bootstrap,
      },
      200,
    );
  });

  app.openapi(updateCurrentProfileRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").users.updateCurrentProfile({
      subject,
      ...(body.email === undefined ? {} : { email: body.email }),
      ...(body.name === undefined ? {} : { name: body.name }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(listOrganizationsRoute, async (context) => {
    const subject = context.get("subject");
    const { organizations } = await context
      .get("services")
      .workspace.bootstrap(subject);
    return context.json({ data: organizations });
  });

  app.openapi(listWorkspacesRoute, async (context) => {
    const subject = context.get("subject");
    const { workspaces } = await context
      .get("services")
      .workspace.bootstrap(subject);
    return context.json({ data: workspaces });
  });
}
