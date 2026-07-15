import type { RomeoApi } from "../context";
import { formatAdminAnalyticsSummaryCsv } from "../../services/analytics-service";

export function registerAdminAnalyticsRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/analytics/summary", async (context) => {
    const subject = context.get("subject");
    const services = context.get("services");
    const [jobSummary, providerSummary] = await Promise.all([
      services.jobs.operationalSummary(subject),
      services.runs.providerOperationalSummary(subject),
    ]);
    const data = await services.analytics.summary(subject, {
      jobSummary,
      providerSummary,
    });
    return context.json({ data });
  });

  app.get("/api/v1/admin/analytics/summary.csv", async (context) => {
    const subject = context.get("subject");
    const services = context.get("services");
    const [jobSummary, providerSummary] = await Promise.all([
      services.jobs.operationalSummary(subject),
      services.runs.providerOperationalSummary(subject),
    ]);
    const data = await services.analytics.summary(subject, {
      jobSummary,
      providerSummary,
    });
    return context.text(formatAdminAnalyticsSummaryCsv(data), 200, {
      "content-disposition":
        'attachment; filename="romeo-admin-analytics-summary.csv"',
      "content-type": "text/csv; charset=utf-8",
    });
  });
}
