import type { RomeoApi } from "../context";

export function registerKubernetesPostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/kubernetes/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .kubernetesPosture.report(subject);
    return context.json({ data });
  });
}
