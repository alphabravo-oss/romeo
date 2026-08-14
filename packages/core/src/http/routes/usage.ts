import {
  exportUsageEventsRoute,
  getUsageSummaryRoute,
  listUsageAlertsRoute,
  listUsageEventsRoute,
  listUsageMetricDefinitionsRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerUsageRoutes(app: RomeoApi): void {
  app.openapi(listUsageEventsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").usage.list(subject);
    return context.json({ data });
  });

  app.openapi(listUsageMetricDefinitionsRoute, (context) => {
    const subject = context.get("subject");
    const data = context.get("services").usage.taxonomy(subject);
    return context.json({ data });
  });

  app.openapi(exportUsageEventsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").usage.exportEventsCsv(subject);
    return context.text(data, 200, {
      "content-disposition": 'attachment; filename="romeo-usage-events.csv"',
      "content-type": "text/csv; charset=utf-8",
    });
  });

  app.openapi(getUsageSummaryRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").usage.summary(subject);
    return context.json({ data });
  });

  app.openapi(listUsageAlertsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").usage.alerts(subject);
    return context.json({ data });
  });
}
