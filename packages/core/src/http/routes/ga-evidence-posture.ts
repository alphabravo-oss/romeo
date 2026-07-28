import { getGaEvidencePostureRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerGaEvidencePostureRoutes(app: RomeoApi): void {
  app.openapi(getGaEvidencePostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .gaEvidencePosture.report(subject);
    return context.json({ data }, 200);
  });
}
