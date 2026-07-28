import { getEdgeSecurityPostureRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerEdgeSecurityRoutes(app: RomeoApi): void {
  app.openapi(getEdgeSecurityPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").edgeSecurity.report(subject);
    return context.json({ data }, 200);
  });
}
