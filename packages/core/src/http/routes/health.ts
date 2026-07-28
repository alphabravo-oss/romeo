import { getHealthRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerHealthRoutes(app: RomeoApi): void {
  app.openapi(getHealthRoute, (context) =>
    context.json(
      {
        data: {
          status: "ok",
          service: "romeo-api",
          version: "0.1.0",
          requestId: context.get("requestId"),
        },
      },
      200,
    ),
  );
}
