import { exportAuditLogsRoute, listAuditLogsRoute } from "@romeo/contracts";
import type { RomeoApi } from "../context";
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
  outcome?: "failure" | "success" | undefined;
  resourceId?: string | undefined;
  resourceType?: string | undefined;
}): AuditLogFilter {
  return {
    ...(input.action === undefined ? {} : { action: input.action }),
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
    ...(input.resourceType === undefined
      ? {}
      : { resourceType: input.resourceType }),
  };
}
