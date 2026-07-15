import type { RomeoApi } from "../context";

export function registerSecretRotationDrillPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/secret-rotation/drill-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .secretRotationDrillPosture.report(subject);
    return context.json({ data });
  });
}
