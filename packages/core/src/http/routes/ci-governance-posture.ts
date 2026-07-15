import type { RomeoApi } from "../context";

export function registerCiGovernancePostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/ci-governance/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .ciGovernancePosture.report(subject);
    return context.json({ data });
  });
}
