import type { ProviderInstance, ProviderKind } from "@romeo/providers";

import type { RomeoApi } from "../context";
import { createProviderSchema, updateModelPricingSchema } from "../schemas";
import { parseManagedSecretRef } from "../../services/secret-refs";

export function registerProviderRoutes(app: RomeoApi): void {
  app.get("/api/v1/providers", async (context) => {
    const subject = context.get("subject");
    const data = (await context.get("services").providers.list(subject)).map(
      toProviderResponse,
    );
    return context.json({ data });
  });

  app.get("/api/v1/providers/operational-summary", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .runs.providerOperationalSummary(subject);
    return context.json({ data });
  });

  app.post("/api/v1/providers", async (context) => {
    const subject = context.get("subject");
    const body = createProviderSchema.parse(await context.req.json());
    const data = await context.get("services").providers.create({
      subject,
      type: body.type as ProviderKind,
      name: body.name,
      baseUrl: body.baseUrl,
      ...(body.credentialRef === undefined
        ? {}
        : { credentialRef: body.credentialRef }),
    });

    return context.json({ data: toProviderResponse(data) }, 201);
  });

  app.post("/api/v1/providers/:providerId/sync", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .providers.syncModels(subject, context.req.param("providerId"));
    return context.json({ data });
  });

  app.get("/api/v1/models", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").providers.models(subject);
    return context.json({ data });
  });

  app.patch("/api/v1/models/:modelId/pricing", async (context) => {
    const subject = context.get("subject");
    const body = updateModelPricingSchema.parse(await context.req.json());
    const data = await context.get("services").providers.updateModelPricing({
      subject,
      modelId: context.req.param("modelId"),
      pricing: body,
    });
    return context.json({ data });
  });
}

function toProviderResponse(provider: ProviderInstance) {
  const { credentialRef: _credentialRef, ...safeProvider } = provider;
  const scheme = credentialRefScheme(provider.credentialRef);
  return {
    ...safeProvider,
    credentialConfigured: provider.credentialRef !== undefined,
    ...(scheme === undefined ? {} : { credentialRefScheme: scheme }),
  };
}

function credentialRefScheme(
  credentialRef: string | undefined,
): string | undefined {
  if (credentialRef === undefined) return undefined;
  try {
    return parseManagedSecretRef(credentialRef).scheme;
  } catch {
    return "invalid";
  }
}
