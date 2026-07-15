import type { RomeoApi } from "../context";

export function registerSupportBundlePostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/support-bundle/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .supportBundlePosture.report(subject);
    return context.json({ data });
  });
}
