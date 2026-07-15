import type { RomeoApi } from "../context";

export function registerTargetQualityPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/target-quality/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .targetQualityPosture.report(subject);
    return context.json({ data });
  });
}
