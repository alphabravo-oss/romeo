import type { RomeoApi } from "../context";

export function registerVoiceProviderLivePostureRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/voice/provider-live-posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .voiceProviderLivePosture.report(subject);
    return context.json({ data });
  });
}
