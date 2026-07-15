import { dataEnvelope, jsonContent } from "./helpers";

export const notificationAdapterLivePosturePaths = {
  "/admin/notifications/adapter-live-posture": {
    get: {
      summary: "Read target notification adapter live-evidence posture",
      responses: {
        200: {
          description:
            "Metadata-only notification adapter, egress, retry/dead-letter, secret-resolution, log-redaction, and evidence-redaction posture for the selected target deployment.",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/NotificationAdapterLivePostureReport",
            }),
          ),
        },
      },
    },
  },
};
