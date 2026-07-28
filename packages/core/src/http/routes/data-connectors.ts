import {
  createDataConnectorRoute,
  getDataConnectorCatalogRoute,
  getDataConnectorPostureRoute,
  listDataConnectorsRoute,
  listDataConnectorSyncsRoute,
  syncDataConnectorRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerDataConnectorRoutes(app: RomeoApi): void {
  app.openapi(getDataConnectorPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").dataConnectors.posture(subject);
    return context.json({ data });
  });

  app.openapi(listDataConnectorsRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const data = await context
      .get("services")
      .dataConnectors.list(subject, query.workspaceId);
    return context.json({ data });
  });

  app.openapi(getDataConnectorCatalogRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").dataConnectors.catalog(subject);
    return context.json({ data });
  });

  app.openapi(createDataConnectorRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").dataConnectors.create({
      subject,
      workspaceId: body.workspaceId,
      knowledgeBaseId: body.knowledgeBaseId,
      type: body.type,
      name: body.name,
      config: body.config,
      ...(body.syncIntervalMinutes === undefined
        ? {}
        : { syncIntervalMinutes: body.syncIntervalMinutes }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(syncDataConnectorRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { connectorId } = context.req.valid("param");
    const data = await context.get("services").dataConnectors.sync({
      subject,
      connectorId,
      ...(body.items !== undefined ? { items: body.items } : {}),
    });
    return context.json({ data }, 202);
  });

  app.openapi(listDataConnectorSyncsRoute, async (context) => {
    const subject = context.get("subject");
    const { connectorId } = context.req.valid("param");
    const data = await context
      .get("services")
      .dataConnectors.syncs(subject, connectorId);
    return context.json({ data });
  });
}
