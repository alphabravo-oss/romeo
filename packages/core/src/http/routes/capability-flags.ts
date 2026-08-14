import {
  CapabilityFlagAdminReportSchema,
  EffectiveCapabilityFlagSchema,
  OrganizationCapabilityFlagSchema,
  getCapabilityFlagAdminReportRoute,
  getCapabilityFlagHistoryRoute,
  listEffectiveCapabilityFlagsRoute,
  updateCapabilityFlagRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerCapabilityFlagRoutes(app: RomeoApi): void {
  app.openapi(listEffectiveCapabilityFlagsRoute, async (context) => {
    const data = EffectiveCapabilityFlagSchema.array().parse(
      await context
        .get("services")
        .capabilityFlags.listEffective(context.get("subject")),
    );
    return context.json({ data }, 200);
  });

  app.openapi(getCapabilityFlagAdminReportRoute, async (context) => {
    const data = CapabilityFlagAdminReportSchema.parse(
      await context
        .get("services")
        .capabilityFlags.adminReport(context.get("subject")),
    );
    return context.json({ data }, 200);
  });

  app.openapi(getCapabilityFlagHistoryRoute, async (context) => {
    const { flagId } = context.req.valid("param");
    const data = OrganizationCapabilityFlagSchema.array().parse(
      await context
        .get("services")
        .capabilityFlags.history(context.get("subject"), flagId),
    );
    return context.json({ data }, 200);
  });

  app.openapi(updateCapabilityFlagRoute, async (context) => {
    const { flagId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = OrganizationCapabilityFlagSchema.parse(
      await context.get("services").capabilityFlags.update({
        subject: context.get("subject"),
        flagId,
        state: body.state,
        allowlistedSubjects: body.allowlistedSubjects,
        reason: body.reason,
        ...(body.expectedVersion === undefined
          ? {}
          : { expectedVersion: body.expectedVersion }),
      }),
    );
    return context.json({ data }, 200);
  });
}
