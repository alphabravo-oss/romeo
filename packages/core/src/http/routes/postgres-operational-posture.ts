import type { RomeoApi } from "../context";

export function registerPostgresOperationalPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/postgres/operational-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .postgresOperationalPosture.report(subject);
    return context.json({ data });
  });
}
