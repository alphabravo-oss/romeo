import { generateImagesRoute } from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { resolveIdempotencyKey } from "../../services/idempotency-service";
import { applyIdempotencyHeaders } from "../idempotency-response";

export function registerImageRoutes(app: RomeoApi): void {
  app.openapi(generateImagesRoute, async (context) => {
    const body = context.req.valid("json");
    const key = resolveIdempotencyKey(
      context.req.valid("header")["idempotency-key"],
      body.idempotencyKey,
    );
    const request = {
      workspaceId: body.workspaceId,
      modelId: body.modelId,
      prompt: body.prompt,
      count: body.count,
      size: body.size,
    };
    const result = await context.get("services").idempotency.execute({
      subject: context.get("subject"),
      operation: "images.generate",
      ...(key === undefined ? {} : { key }),
      request,
      responseStatus: 201,
      work: (idempotency) =>
        context
          .get("services")
          .images.generate(
            context.get("subject"),
            request,
            idempotency === undefined
              ? {}
              : { providerIdempotencyKey: idempotency.receiptId },
          ),
    });
    applyIdempotencyHeaders(context, result.idempotency);
    return context.json({ data: result.value }, 201);
  });
}
