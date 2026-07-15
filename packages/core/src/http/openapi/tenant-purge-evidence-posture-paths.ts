import { errorResponse, success } from "./helpers";

export const tenantPurgeEvidencePosturePaths = {
  "/admin/tenant-deletion/purge-evidence-posture": {
    get: {
      summary: "Get metadata-only tenant purge evidence posture",
      responses: {
        200: success("Tenant purge evidence posture", {
          $ref: "#/components/schemas/TenantPurgeEvidencePostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
