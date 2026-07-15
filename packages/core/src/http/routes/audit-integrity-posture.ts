import type { RomeoApi } from "../context";

export function registerAuditIntegrityPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/audit-integrity/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .auditIntegrityPosture.report(subject);
    return context.json({ data });
  });
}
