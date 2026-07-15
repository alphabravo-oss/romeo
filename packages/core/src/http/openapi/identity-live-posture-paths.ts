import { dataEnvelope, jsonContent } from "./helpers";

export const identityLivePosturePaths = {
  "/admin/identity/live-posture": {
    get: {
      summary: "Read target identity live-evidence posture",
      responses: {
        200: {
          description:
            "Metadata-only target identity evidence posture for live IdP, directory, SCIM, access-review, secret-backend, and redaction validation.",
          content: jsonContent(
            dataEnvelope({
              $ref: "#/components/schemas/IdentityLivePostureReport",
            }),
          ),
        },
      },
    },
  },
};
