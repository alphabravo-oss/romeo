import { errorResponse, success } from "./helpers";

export const migrationDrillPosturePaths = {
  "/admin/migrations/drill-posture": {
    get: {
      summary: "Get metadata-only failed migration drill posture",
      responses: {
        200: success("Migration drill posture", {
          $ref: "#/components/schemas/MigrationDrillPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
