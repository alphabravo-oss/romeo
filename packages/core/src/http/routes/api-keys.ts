import {
  bulkRevokeApiKeysRoute,
  createApiKeyRoute,
  listApiKeysRoute,
  revokeApiKeyRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerApiKeyRoutes(app: RomeoApi): void {
  app.openapi(listApiKeysRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").apiKeys.list(subject);
    return context.json({ data });
  });

  app.openapi(createApiKeyRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .apiKeys.create({ subject, name: body.name, scopes: body.scopes });
    return context.json({ data }, 201);
  });

  app.openapi(bulkRevokeApiKeysRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .apiKeys.bulkRevoke({ subject, apiKeyIds: body.apiKeyIds });
    return context.json({ data });
  });

  app.openapi(revokeApiKeyRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").apiKeys.revoke({
      subject,
      apiKeyId: context.req.valid("param").apiKeyId,
    });
    return context.json({ data });
  });
}
