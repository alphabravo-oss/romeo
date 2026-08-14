import {
  exportAuditLogsRoute,
  listAuditLogsRoute,
  queryAuditLogsRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";
import { assertCapabilityFlagEnabled } from "../../services/capability-flag-enforcement";
import type {
  AuditLogFilter,
  AuditLogPageOptions,
} from "../../services/audit-service";

export function registerAuditRoutes(app: RomeoApi): void {
  app.openapi(listAuditLogsRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const options: AuditLogPageOptions = {
      filter: auditFilter(query),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    };
    const page = await context.get("services").audit.listPage(subject, options);
    return page.nextCursor !== undefined
      ? context.json({ data: page.data, nextCursor: page.nextCursor })
      : context.json({ data: page.data });
  });

  app.openapi(queryAuditLogsRoute, async (context) => {
    await assertCapabilityFlagEnabled(
      context.get("services").capabilityFlags,
      context.get("subject"),
      "server_table_v2",
    );
    const page = await context
      .get("services")
      .audit.queryTable(context.get("subject"), context.req.valid("json"));
    return context.json(page);
  });

  app.openapi(exportAuditLogsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .audit.exportCsv(subject, auditFilter(context.req.valid("query")));
    return context.text(data, 200, {
      "content-disposition": 'attachment; filename="romeo-audit-logs.csv"',
      "content-type": "text/csv; charset=utf-8",
    });
  });
}

function auditFilter(input: {
  action?: string | undefined;
  actorId?: string | undefined;
  category?: AuditLogFilter["category"];
  from?: string | undefined;
  includeNoise?: "true" | "false" | undefined;
  outcome?: "failure" | "success" | undefined;
  q?: string | undefined;
  resourceId?: string | undefined;
  resourceType?: string | undefined;
  to?: string | undefined;
}): AuditLogFilter {
  return {
    ...(input.action === undefined ? {} : { action: input.action }),
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.includeNoise === undefined
      ? {}
      : { includeNoise: input.includeNoise === "true" }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.q === undefined ? {} : { q: input.q }),
    ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
    ...(input.resourceType === undefined
      ? {}
      : { resourceType: input.resourceType }),
    ...(input.to === undefined ? {} : { to: input.to }),
  };
}
