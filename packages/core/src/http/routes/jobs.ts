import type { RomeoApi } from "../context";

export function registerJobRoutes(app: RomeoApi): void {
  app.get("/api/v1/jobs", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").jobs.list(subject);
    return context.json({ data });
  });

  app.get("/api/v1/jobs/operational-summary", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").jobs.operationalSummary(subject);
    return context.json({ data });
  });
}
