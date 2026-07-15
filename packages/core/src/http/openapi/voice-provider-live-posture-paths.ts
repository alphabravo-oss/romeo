import { dataEnvelope, jsonContent } from "./helpers";

export const voiceProviderLivePosturePaths = {
  "/admin/voice/provider-live-posture": {
    get: {
      summary: "Read target voice provider live-evidence posture",
      responses: {
        200: {
          description:
            "Metadata-only production TTS/STT provider evidence posture for live provider acceptance, artifact readback, streaming consent, log redaction, and evidence redaction.",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/VoiceProviderLivePostureReport",
            }),
          ),
        },
      },
    },
  },
};
