import type { RomeoApi } from "../context";

export function registerIdentityLivePostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/identity/live-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .identityLivePosture.report(subject);
    return context.json({ data });
  });
}
