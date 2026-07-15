import type { RomeoApi } from "../context";

export function registerMigrationDrillPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/migrations/drill-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .migrationDrillPosture.report(subject);
    return context.json({ data });
  });
}
