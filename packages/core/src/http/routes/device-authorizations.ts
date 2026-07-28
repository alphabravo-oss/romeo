import {
  createDeviceAuthorizationRoute,
  listDeviceAuthorizationsRoute,
  refreshDeviceAuthorizationRoute,
  revokeDeviceAuthorizationRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerDeviceAuthorizationRoutes(app: RomeoApi): void {
  app.openapi(listDeviceAuthorizationsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .deviceAuthorizations.list(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createDeviceAuthorizationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").deviceAuthorizations.create({
      subject,
      name: body.name,
      scopes: body.scopes,
      ...(body.ttlDays === undefined ? {} : { ttlDays: body.ttlDays }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(refreshDeviceAuthorizationRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .deviceAuthorizations.refresh(body.refreshToken);
    return context.json({ data }, 200);
  });

  app.openapi(revokeDeviceAuthorizationRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").deviceAuthorizations.revoke({
      subject,
      deviceAuthorizationId: context.req.valid("param").deviceAuthorizationId,
    });
    return context.json({ data }, 200);
  });
}
