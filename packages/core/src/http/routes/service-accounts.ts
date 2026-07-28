import {
  bulkDisableServiceAccountsRoute,
  createServiceAccountApiKeyRoute,
  createServiceAccountRoute,
  disableServiceAccountRoute,
  listServiceAccountsRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerServiceAccountRoutes(app: RomeoApi): void {
  app.openapi(listServiceAccountsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").serviceAccounts.list(subject);
    return context.json({ data });
  });

  app.openapi(createServiceAccountRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").serviceAccounts.create({
      subject,
      name: body.name,
      scopes: body.scopes,
    });
    return context.json({ data }, 201);
  });

  app.openapi(bulkDisableServiceAccountsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").serviceAccounts.bulkDisable({
      subject,
      serviceAccountIds: body.serviceAccountIds,
    });
    return context.json({ data });
  });

  app.openapi(createServiceAccountApiKeyRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").serviceAccounts.createApiKey({
      subject,
      serviceAccountId: context.req.valid("param").serviceAccountId,
      name: body.name,
      scopes: body.scopes,
    });
    return context.json({ data }, 201);
  });

  app.openapi(disableServiceAccountRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").serviceAccounts.disable({
      subject,
      serviceAccountId: context.req.valid("param").serviceAccountId,
    });
    return context.json({ data });
  });
}
