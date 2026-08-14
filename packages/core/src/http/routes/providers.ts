import { type ProviderKind } from "@romeo/providers";
import {
  createProviderConnectionRoute,
  deleteOllamaModelRoute,
  getProviderCapabilityReportRoute,
  getProviderModelCapabilityReportRoute,
  getProviderOperationalSummaryRoute,
  listProviderKindsRoute,
  listProviderConnectionsRoute,
  getProviderCatalogSyncJobRoute,
  listProviderModelsRoute,
  pullOllamaModelRoute,
  runProviderCatalogSyncJobRoute,
  syncProviderModelsRoute,
  updateProviderConnectionRoute,
  updateProviderModelCapabilitiesRoute,
  updateProviderModelEnabledRoute,
  updateProviderModelPricingRoute,
  verifyProviderConnectionRoute,
  probeModelRoute,
  updateModelCapabilityOverridesRoute,
  previewModelCompatibilityRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { listProviderKindCatalog } from "../../services/provider-kind-catalog";


export function registerProviderRoutes(app: RomeoApi): void {
  app.openapi(listProviderKindsRoute, (context) =>
    context.json(
      { data: listProviderKindCatalog(context.get("subject")) },
      200,
    ),
  );

  app.openapi(getProviderCapabilityReportRoute, async (context) => {
    const data = await context
      .get("services")
      .providerCapabilityReports.provider(
        context.get("subject"),
        context.req.valid("param").providerId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(getProviderModelCapabilityReportRoute, async (context) => {
    const data = await context
      .get("services")
      .providerCapabilityReports.model(
        context.get("subject"),
        context.req.valid("param").modelId,
      );
    return context.json({ data }, 200);
  });

  app.openapi(listProviderConnectionsRoute, async (context) => {
    const data = await context
      .get("services")
      .providers.presentConnections(context.get("subject"));
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
      ...(body.auth === undefined ? {} : { auth: body.auth }),
      ...(body.credentialRef === undefined
        ? {}
        : { credentialRef: body.credentialRef }),
      ...(body.deployment === undefined ? {} : { deployment: body.deployment }),
      ...(body.modelIds === undefined ? {} : { modelIds: body.modelIds }),
      ...(body.project === undefined ? {} : { project: body.project }),
      ...(body.region === undefined ? {} : { region: body.region }),
      ...(body.target === undefined ? {} : { target: body.target }),
    });

    return context.json(
      {
        data: await context.get("services").providers.presentConnection(data),
      },
      201,
    );
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
      ...(body.auth === undefined ? {} : { auth: body.auth }),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }),
      ...(body.credentialRef === undefined
        ? {}
        : { credentialRef: body.credentialRef }),
      ...(body.deployment === undefined ? {} : { deployment: body.deployment }),
      ...(body.modelIds === undefined ? {} : { modelIds: body.modelIds }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.project === undefined ? {} : { project: body.project }),
      ...(body.region === undefined ? {} : { region: body.region }),
      ...(body.target === undefined ? {} : { target: body.target }),
    });
    return context.json(
      { data: await context.get("services").providers.presentConnection(data) },
      200,
    );
  });

  app.openapi(syncProviderModelsRoute, async (context) => {
    const subject = context.get("subject");
    const { providerId } = context.req.valid("param");
    const started = await context
      .get("services")
      .providers.catalogSyncJobs.start({
        mode: context.req.valid("query").mode ?? "inline",
        providerId,
        subject,
      });
    if (started.mode === "async_job")
      return context.json({ data: started.job }, 202);
    const data = await context
      .get("services")
      .providers.syncModels(subject, providerId);
    return context.json({ data }, 200);
  });

  app.openapi(runProviderCatalogSyncJobRoute, async (context) => {
    const data = await context.get("services").providers.catalogSyncJobs.run({
      jobId: context.req.valid("param").jobId,
      subject: context.get("subject"),
    });
    return context.json({ data }, 200);
  });

  app.openapi(getProviderCatalogSyncJobRoute, async (context) => {
    const data = await context.get("services").providers.catalogSyncJobs.get({
      jobId: context.req.valid("param").jobId,
      subject: context.get("subject"),
    });
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
      const page = await context.get("services").providers.presentModelsPage(subject, {
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
    const data = await context.get("services").providers.presentModels(subject);
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
        streaming: body.capabilities.streaming,
        toolCalling: body.capabilities.toolCalling,
        vision: body.capabilities.vision,
        audioInput: body.capabilities.audioInput,
        structuredJson: body.capabilities.structuredJson,
        reasoning: body.capabilities.reasoning,
        modalities: body.capabilities.modalities,
        deployment: body.capabilities.deployment,
        imageGeneration: body.capabilities.imageGeneration ?? false,
        ...(body.capabilities.temperature === undefined
          ? {}
          : { temperature: body.capabilities.temperature }),
      },
      ...(body.defaultParameters === undefined
        ? {}
        : {
            defaultParameters: {
              ...(body.defaultParameters.temperature === undefined
                ? {}
                : { temperature: body.defaultParameters.temperature }),
              ...(body.defaultParameters.topP === undefined
                ? {}
                : { topP: body.defaultParameters.topP }),
              ...(body.defaultParameters.maxOutputTokens === undefined
                ? {}
                : { maxOutputTokens: body.defaultParameters.maxOutputTokens }),
            },
          }),
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

  app.openapi(probeModelRoute, async (context) => {
    const data = await context.get("services").modelCapabilityProbes.probe({
      subject: context.get("subject"),
      modelId: context.req.valid("param").modelId,
      features: context.req.valid("json").features,
    });
    return context.json({ data }, 200);
  });

  app.openapi(updateModelCapabilityOverridesRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context.get("services").modelCapabilityProbes.override({
      subject: context.get("subject"),
      modelId: context.req.valid("param").modelId,
      reason: body.reason,
      ...(body.tools === undefined ? {} : { tools: body.tools }),
      ...(body.reasoning === undefined ? {} : { reasoning: body.reasoning }),
      ...(body.vision === undefined ? {} : { vision: body.vision }),
      ...(body.imageOutput === undefined ? {} : { imageOutput: body.imageOutput }),
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(previewModelCompatibilityRoute, async (context) => {
    const body = context.req.valid("json");
    const data = await context.get("services").modelCapabilityProbes.preview({
      subject: context.get("subject"),
      modelId: body.modelId,
      required: body.required,
    });
    return context.json({ data }, 200);
  });
}
