import type { RomeoApi } from "../context";

export function registerAnalyticsAuthzPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/analytics/authz-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .analyticsAuthzPosture.report(subject);
    return context.json({ data });
  });
}
