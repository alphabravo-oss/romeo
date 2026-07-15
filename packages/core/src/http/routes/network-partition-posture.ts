import type { RomeoApi } from "../context";

export function registerNetworkPartitionPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/network/partition-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .networkPartitionPosture.report(subject);
    return context.json({ data });
  });
}
