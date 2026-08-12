import {
  getInterfacePreferencesRoute,
  updateInterfacePreferencesRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import type { InterfacePreferences } from "../../services/interface-preference-service";

export function registerPreferenceRoutes(app: RomeoApi): void {
  app.openapi(getInterfacePreferencesRoute, async (context) =>
    context.json(
      {
        data: await context
          .get("services")
          .interfacePreferences.get(context.get("subject")),
      },
      200,
    ),
  );

  app.openapi(updateInterfacePreferencesRoute, async (context) => {
    const subject = context.get("subject");
    // exactOptionalPropertyTypes: omit keys rather than pass `prop: undefined`.
    const body = context.req.valid("json");
    const patch = Object.fromEntries(
      Object.entries(body).filter((entry) => entry[1] !== undefined),
    ) as Partial<InterfacePreferences>;
    const data = await context
      .get("services")
      .interfacePreferences.update(subject, patch);
    return context.json({ data }, 200);
  });
}
