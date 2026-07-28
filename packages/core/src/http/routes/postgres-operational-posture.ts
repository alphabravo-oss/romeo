import { getPostgresOperationalPostureRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerPostgresOperationalPostureRoutes(app: RomeoApi): void {
  app.openapi(getPostgresOperationalPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .postgresOperationalPosture.report(subject);
    return context.json({ data }, 200);
  });
}
