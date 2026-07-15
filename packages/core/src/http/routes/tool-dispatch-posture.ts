import type { RomeoApi } from "../context";

export function registerToolDispatchPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/tool-dispatch/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .toolDispatchPosture.report(subject);
    return context.json({ data });
  });
}
