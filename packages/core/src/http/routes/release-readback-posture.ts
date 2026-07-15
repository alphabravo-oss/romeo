import type { RomeoApi } from "../context";

export function registerReleaseReadbackPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/release-readback/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .releaseReadbackPosture.report(subject);
    return context.json({ data });
  });
}
