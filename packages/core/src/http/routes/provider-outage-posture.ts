import type { RomeoApi } from "../context";

export function registerProviderOutagePostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/providers/outage-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .providerOutagePosture.report(subject);
    return context.json({ data });
  });
}
