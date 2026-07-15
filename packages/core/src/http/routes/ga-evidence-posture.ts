import type { RomeoApi } from "../context";

export function registerGaEvidencePostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/ga/evidence-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .gaEvidencePosture.report(subject);
    return context.json({ data });
  });
}
