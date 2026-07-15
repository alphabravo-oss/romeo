import type { RomeoApi } from "../context";

export function registerAlertFiringPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/alert-firing/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .alertFiringPosture.report(subject);
    return context.json({ data });
  });
}
