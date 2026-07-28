import {
  createQuotaBucketRoute,
  deleteQuotaBucketRoute,
  getQuotaCoordinationStatusRoute,
  listQuotaBucketsRoute,
  updateQuotaBucketRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerQuotaRoutes(app: RomeoApi): void {
  app.openapi(listQuotaBucketsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").quotas.list(subject);
    return context.json({ data });
  });

  app.openapi(getQuotaCoordinationStatusRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .quotas.coordinationStatus(subject);
    return context.json({ data });
  });

  app.openapi(createQuotaBucketRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      scopeType: typeof body.scopeType;
      metric: typeof body.metric;
      limit: number;
      resetInterval: typeof body.resetInterval;
      scopeId?: string;
    } = {
      subject,
      scopeType: body.scopeType,
      metric: body.metric,
      limit: body.limit,
      resetInterval: body.resetInterval,
    };
    if (body.scopeId !== undefined) input.scopeId = body.scopeId;
    const data = await context.get("services").quotas.create(input);
    return context.json({ data }, 201);
  });

  app.openapi(updateQuotaBucketRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      quotaBucketId: string;
      limit?: number;
      resetInterval?: "none" | "daily" | "monthly";
      resetUsage?: boolean;
    } = {
      subject,
      quotaBucketId: context.req.valid("param").quotaBucketId,
    };
    if (body.limit !== undefined) input.limit = body.limit;
    if (body.resetInterval !== undefined)
      input.resetInterval = body.resetInterval;
    if (body.resetUsage !== undefined) input.resetUsage = body.resetUsage;
    const data = await context.get("services").quotas.update(input);
    return context.json({ data });
  });

  app.openapi(deleteQuotaBucketRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .quotas.delete(subject, context.req.valid("param").quotaBucketId);
    return context.json({ data });
  });
}
