import type { RomeoApi } from "../context";

export function registerEdgeSecurityRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/edge-security/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").edgeSecurity.report(subject);
    return context.json({ data });
  });
}
