import type { RomeoApi } from "../context";

export function registerBillingOperationsPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/billing/operations-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .billingOperationsPosture.report(subject);
    return context.json({ data });
  });
}
