import type { RomeoApi } from "../context";

export function registerReleaseSecurityPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/release-security/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .releaseSecurityPosture.report(subject);
    return context.json({ data });
  });
}
