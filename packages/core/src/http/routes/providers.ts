import type { ProviderInstance, ProviderKind } from "@romeo/providers";
import {
  createProviderConnectionRoute,
  deleteOllamaModelRoute,
  getProviderOperationalSummaryRoute,
  listProviderConnectionsRoute,
  listProviderModelsRoute,
  pullOllamaModelRoute,
  syncProviderModelsRoute,
  updateProviderConnectionRoute,
  updateProviderModelCapabilitiesRoute,
  updateProviderModelEnabledRoute,
  updateProviderModelPricingRoute,
  verifyProviderConnectionRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { parseManagedSecretRef } from "../../services/secret-refs";

export function registerProviderRoutes(app: RomeoApi): void {
  app.openapi(listProviderConnectionsRoute, async (context) => {
    const subject = context.get("subject");
    const data = (await context.get("services").providers.list(subject)).map(
      toProviderResponse,
    );
    return context.json({ data }, 200);
  });

  app.openapi(getProviderOperationalSummaryRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .runs.providerOperationalSummary(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createProviderConnectionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").providers.create({
      subject,
      type: body.type as ProviderKind,
      name: body.name,
      baseUrl: body.baseUrl,
      ...(body.credentialRef === undefined
        ? {}
        : { credentialRef: body.credentialRef }),
      ...(body.modelIds === undefined ? {} : { modelIds: body.modelIds }),
    });

    return context.json({ data: toProviderResponse(data) }, 201);
  });

  app.openapi(verifyProviderConnectionRoute, async (context) => {
    const subject = context.get("subject");
    const { providerId } = context.req.valid("param");
    const data = await context
      .get("services")
      .providers.verify(subject, providerId);
    return context.json({ data }, 200);
  });

  app.openapi(updateProviderConnectionRoute, async (context) => {
    const subject = context.get("subject");
    const { providerId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").providers.update({
      subject,
      providerId,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }),
      ...(body.credentialRef === undefined
        ? {}
        : { credentialRef: body.credentialRef }),
      ...(body.modelIds === undefined ? {} : { modelIds: body.modelIds }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    });
    return context.json({ data: toProviderResponse(data) }, 200);
  });

  app.openapi(syncProviderModelsRoute, async (context) => {
    const subject = context.get("subject");
    const { providerId } = context.req.valid("param");
    const data = await context
      .get("services")
      .providers.syncModels(subject, providerId);
    return context.json({ data }, 200);
  });

  app.openapi(pullOllamaModelRoute, async (context) => {
    const subject = context.get("subject");
    const { providerId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .providers.pullModel(subject, providerId, body.model);
    return context.json({ data }, 200);
  });

  app.openapi(deleteOllamaModelRoute, async (context) => {
    const { providerId, model } = context.req.valid("param");
    const data = await context
      .get("services")
      .providers.deleteModel(context.get("subject"), providerId, model);
    return context.json({ data }, 200);
  });

  app.openapi(listProviderModelsRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const { limit, offset } = query;
    if (limit !== undefined) {
      const available =
        query.available === undefined ? undefined : query.available === "true";
      const enabled =
        query.enabled === undefined ? undefined : query.enabled === "true";
      const page = await context.get("services").providers.modelsPage(subject, {
        limit,
        offset: offset ?? 0,
        ...(query.direction === undefined
          ? {}
          : { direction: query.direction }),
        ...(query.q === undefined ? {} : { query: query.q }),
        ...(query.providerId === undefined
          ? {}
          : { providerId: query.providerId }),
        ...(available === undefined ? {} : { available }),
        ...(enabled === undefined ? {} : { enabled }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
      });
      return context.json(
        {
          data: page.items,
          meta: {
            limit: page.limit,
            offset: page.offset,
            total: page.total,
            hasMore: page.offset + page.items.length < page.total,
          },
        },
        200,
      );
    }
    const data = await context.get("services").providers.models(subject);
    return context.json({ data }, 200);
  });

  app.openapi(updateProviderModelPricingRoute, async (context) => {
    const subject = context.get("subject");
    const { modelId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").providers.updateModelPricing({
      subject,
      modelId,
      pricing: {
        inputTokenUsd: body.inputTokenUsd,
        outputTokenUsd: body.outputTokenUsd,
        ...(body.imageGenerationUsd === undefined
          ? {}
          : { imageGenerationUsd: body.imageGenerationUsd }),
      },
    });
    return context.json({ data }, 200);
  });

  app.openapi(updateProviderModelCapabilitiesRoute, async (context) => {
    const subject = context.get("subject");
    const { modelId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").providers.updateModel({
      subject,
      modelId,
      contextWindow: body.contextWindow,
      capabilities: {
        ...body.capabilities,
        imageGeneration: body.capabilities.imageGeneration ?? false,
      },
    });
    return context.json({ data }, 200);
  });

  app.openapi(updateProviderModelEnabledRoute, async (context) => {
    const subject = context.get("subject");
    const { modelId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").providers.updateModel({
      subject,
      modelId,
      enabled: body.enabled,
    });
    return context.json({ data }, 200);
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
