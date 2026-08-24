import { getRuntimeKeyRotationPostureRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerRuntimeKeyRotationPostureRoutes(app: RomeoApi): void {
  app.openapi(getRuntimeKeyRotationPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .runtimeKeyRotationPosture.report(subject);
    return context.json({ data }, 200);
  });
}
