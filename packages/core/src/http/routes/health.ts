import { getHealthRoute, ROMEO_PRODUCT_VERSION } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerHealthRoutes(app: RomeoApi): void {
  app.openapi(getHealthRoute, (context) =>
    context.json(
      {
        data: {
          status: "ok",
          service: "romeo-api",
          version: ROMEO_PRODUCT_VERSION,
          requestId: context.get("requestId"),
        },
      },
      200,
    ),
  );
}
