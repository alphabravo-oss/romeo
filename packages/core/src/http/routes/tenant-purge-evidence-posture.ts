import type { RomeoApi } from "../context";

export function registerTenantPurgeEvidencePostureRoutes(app: RomeoApi): void {
  app.get(
    "/api/v1/admin/tenant-deletion/purge-evidence-posture",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .tenantPurgeEvidencePosture.report(subject);
      return context.json({ data });
    },
  );
}
