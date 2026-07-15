import { errorResponse, success } from "./helpers";

export const postgresOperationalPaths = {
  "/admin/postgres/operational-posture": {
    get: {
      summary:
        "Report sanitized Postgres scale and operations posture for admins",
      responses: {
        200: success("Postgres operational posture", {
          $ref: "#/components/schemas/PostgresOperationalPostureReport",
        }),
        403: errorResponse,
      },
    },
  },
};
