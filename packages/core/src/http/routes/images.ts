import { generateImagesRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerImageRoutes(app: RomeoApi): void {
  app.openapi(generateImagesRoute, async (context) => {
    const data = await context
      .get("services")
      .images.generate(context.get("subject"), context.req.valid("json"));
    return context.json({ data }, 201);
  });
}
