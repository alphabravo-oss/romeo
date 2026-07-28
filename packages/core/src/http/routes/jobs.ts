import { getJobOperationalSummaryRoute, listJobsRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerJobRoutes(app: RomeoApi): void {
  app.openapi(listJobsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").jobs.list(subject);
    return context.json({ data }, 200);
  });

  app.openapi(getJobOperationalSummaryRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").jobs.operationalSummary(subject);
    return context.json({ data }, 200);
  });
}
