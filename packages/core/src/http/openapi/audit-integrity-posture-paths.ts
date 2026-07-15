import { errorResponse, success } from "./helpers";

export const auditIntegrityPosturePaths = {
  "/admin/audit-integrity/posture": {
    get: {
      summary: "Get metadata-only audit integrity and SIEM export posture",
      responses: {
        200: success("Audit integrity posture", {
          $ref: "#/components/schemas/AuditIntegrityPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
