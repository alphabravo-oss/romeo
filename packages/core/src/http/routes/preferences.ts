import {
  getInterfacePreferencesRoute,
  updateInterfacePreferencesRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

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
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .interfacePreferences.update(subject, {
        ...(body.theme === undefined ? {} : { theme: body.theme }),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.fontSize === undefined ? {} : { fontSize: body.fontSize }),
        ...(body.density === undefined ? {} : { density: body.density }),
        ...(body.reducedMotion === undefined
          ? {}
          : { reducedMotion: body.reducedMotion }),
      });
    return context.json({ data }, 200);
  });
}
