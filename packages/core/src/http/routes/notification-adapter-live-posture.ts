import type { RomeoApi } from "../context";

export function registerNotificationAdapterLivePostureRoutes(
  app: RomeoApi,
): void {
  app.get(
    "/api/v1/admin/notifications/adapter-live-posture",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .notificationAdapterLivePosture.report(subject);
      return context.json({ data });
    },
  );
}
