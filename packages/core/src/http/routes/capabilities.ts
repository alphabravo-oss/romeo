import {
  CapabilityAssignmentSchema,
  CapabilityAdminOverviewSchema,
  CapabilityDefinitionSchema,
  CapabilityImpactPreviewSchema,
  PlatformCapabilityPostureSchema,
  PolicyBundleSchema,
  approveCapabilityPublicationRoute,
  explainCapabilityRoute,
  getCapabilityAdminOverviewRoute,
  getCapabilityAssignmentHistoryRoute,
  getPlatformCapabilityPostureRoute,
  listCapabilityDefinitionsRoute,
  patchCapabilityAssignmentRoute,
  previewCapabilityAssignmentRoute,
  previewCapabilityImpactRoute,
  publishCapabilityAssignmentRoute,
  resolveCapabilitiesRoute,
  updateCapabilityAssignmentRoute,
} from "@romeo/contracts";

import {
  capabilityIds,
  type CapabilityId,
} from "../../services/capability-definition-registry";
import type { CapabilityRequestedValues } from "../../services/capability-resolution-model";
import type { RomeoApi } from "../context";

export function registerCapabilityRoutes(app: RomeoApi): void {
  app.openapi(listCapabilityDefinitionsRoute, (context) => {
    const subject = context.get("subject");
    const data = CapabilityDefinitionSchema.array().parse(
      context.get("services").capabilities.definitions(subject),
    );
    return context.json({ data }, 200);
  });

  app.openapi(getPlatformCapabilityPostureRoute, (context) => {
    const data = PlatformCapabilityPostureSchema.parse(
      context
        .get("services")
        .capabilities.platformPosture(context.get("subject")),
    );
    return context.json({ data }, 200);
  });

  app.openapi(resolveCapabilitiesRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").capabilities.resolveMany({
      subject,
      capabilityIds: body.capabilityIds,
      workspaceId: body.context.workspaceId,
      ...(body.context.modelId === undefined
        ? {}
        : { modelId: body.context.modelId }),
      ...(body.context.agentId === undefined
        ? {}
        : { agentId: body.context.agentId }),
      ...(body.context.agentVersionId === undefined
        ? {}
        : { agentVersionId: body.context.agentVersionId }),
      ...(body.requested === undefined
        ? {}
        : { requested: compactRequested(body.requested) }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(getCapabilityAdminOverviewRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const overview = await context.get("services").capabilities.adminOverview({
      subject,
      scope: { scopeType: query.scopeType, scopeId: query.scopeId },
      ...(query.workspaceId === undefined
        ? {}
        : { workspaceId: query.workspaceId }),
      ...(query.modelId === undefined ? {} : { modelId: query.modelId }),
    });
    const data = CapabilityAdminOverviewSchema.parse(overview);
    return context.json({ data }, 200);
  });

  app.openapi(getCapabilityAssignmentHistoryRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const { capabilityId } = context.req.valid("param");
    const history = await context.get("services").capabilities.history({
      subject,
      capabilityId: capabilityId as CapabilityId,
      scope: { scopeType: query.scopeType, scopeId: query.scopeId },
    });
    const data = CapabilityAssignmentSchema.array().parse(history);
    return context.json({ data }, 200);
  });

  app.openapi(explainCapabilityRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const { capabilityId } = context.req.valid("param");
    const data = await context.get("services").capabilities.explain({
      subject,
      capabilityId: capabilityId as CapabilityId,
      scope: { scopeType: query.scopeType, scopeId: query.scopeId },
      ...(query.workspaceId === undefined
        ? {}
        : { workspaceId: query.workspaceId }),
      ...(query.modelId === undefined ? {} : { modelId: query.modelId }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(updateCapabilityAssignmentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { capabilityId } = context.req.valid("param");
    const assignment = await context
      .get("services")
      .capabilities.updateAssignment({
        subject,
        capabilityId: capabilityId as CapabilityId,
        scope: { scopeType: body.scopeType, scopeId: body.scopeId },
        state: body.state,
        configuration: body.configuration,
        reason: body.reason,
        ...(body.expectedVersion === undefined
          ? {}
          : { expectedVersion: body.expectedVersion }),
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      });
    const data = CapabilityAssignmentSchema.parse(assignment);
    return context.json({ data }, 200);
  });

  app.openapi(patchCapabilityAssignmentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { capabilityId } = context.req.valid("param");
    const assignment = await context
      .get("services")
      .capabilities.updateAssignment({
        subject,
        capabilityId: capabilityId as CapabilityId,
        scope: { scopeType: body.scopeType, scopeId: body.scopeId },
        state: body.state,
        configuration: body.configuration,
        reason: body.reason,
        ...(body.expectedVersion === undefined
          ? {}
          : { expectedVersion: body.expectedVersion }),
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      });
    const data = CapabilityAssignmentSchema.parse(assignment);
    return context.json({ data }, 200);
  });

  app.openapi(previewCapabilityAssignmentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { capabilityId } = context.req.valid("param");
    const data = await context.get("services").capabilities.previewAssignment({
      subject,
      capabilityId: capabilityId as CapabilityId,
      scope: { scopeType: body.scopeType, scopeId: body.scopeId },
      configuration: body.configuration,
      state: body.state,
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      ...(body.workspaceId === undefined
        ? {}
        : { workspaceId: body.workspaceId }),
      ...(body.requested === undefined
        ? {}
        : { requested: compactCapabilityRequest(body.requested) }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(previewCapabilityImpactRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { capabilityId } = context.req.valid("param");
    const preview = await context.get("services").capabilities.previewImpact({
      subject,
      capabilityId: capabilityId as CapabilityId,
      scope: { scopeType: body.scopeType, scopeId: body.scopeId },
      configuration: body.configuration,
      state: body.state,
      samples: body.samples,
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      ...(body.workspaceId === undefined
        ? {}
        : { workspaceId: body.workspaceId }),
      ...(body.requested === undefined
        ? {}
        : { requested: compactCapabilityRequest(body.requested) }),
    });
    const data = CapabilityImpactPreviewSchema.parse(preview);
    return context.json({ data }, 200);
  });

  app.openapi(publishCapabilityAssignmentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const { capabilityId } = context.req.valid("param");
    const published = await context
      .get("services")
      .capabilities.publishAssignment({
        subject,
        capabilityId: capabilityId as CapabilityId,
        scope: { scopeType: body.scopeType, scopeId: body.scopeId },
        state: body.state,
        configuration: body.configuration,
        reason: body.reason,
        ...(body.expectedVersion === undefined
          ? {}
          : { expectedVersion: body.expectedVersion }),
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      });
    const data =
      "publicationRequired" in published
        ? PolicyBundleSchema.parse(published)
        : CapabilityAssignmentSchema.parse(published);
    return context.json({ data }, 200);
  });

  app.openapi(approveCapabilityPublicationRoute, async (context) => {
    const subject = context.get("subject");
    const { bundleId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = PolicyBundleSchema.parse(
      await context.get("services").capabilities.approvePublication({
        subject,
        bundleId,
        reason: body.reason,
      }),
    );
    return context.json({ data }, 200);
  });
}

function compactRequested(
  input: Partial<
    Record<
      CapabilityId,
      {
        selected?: boolean | undefined;
        maxImagesPerRequest?: number | undefined;
        allowedSizes?:
          | Array<"1024x1024" | "1024x1536" | "1536x1024">
          | undefined;
        maxSearchResults?: number | undefined;
        maxUrlsPerRequest?: number | undefined;
        reasoningMode?: "off" | "auto" | "summary" | undefined;
        reasoningEffort?: "low" | "medium" | "high" | undefined;
        maxReasoningTokens?: number | undefined;
        retainReasoningSummary?: boolean | undefined;
      }
    >
  >,
): Partial<Record<CapabilityId, CapabilityRequestedValues>> {
  const result: Partial<Record<CapabilityId, CapabilityRequestedValues>> = {};
  for (const capabilityId of capabilityIds) {
    const value = input[capabilityId];
    if (value === undefined) continue;
    result[capabilityId] = {
      ...(value.selected === undefined ? {} : { selected: value.selected }),
      ...(value.maxImagesPerRequest === undefined
        ? {}
        : { maxImagesPerRequest: value.maxImagesPerRequest }),
      ...(value.allowedSizes === undefined
        ? {}
        : { allowedSizes: value.allowedSizes }),
      ...(value.maxSearchResults === undefined
        ? {}
        : { maxSearchResults: value.maxSearchResults }),
      ...(value.maxUrlsPerRequest === undefined
        ? {}
        : { maxUrlsPerRequest: value.maxUrlsPerRequest }),
      ...(value.reasoningMode === undefined
        ? {}
        : { reasoningMode: value.reasoningMode }),
      ...(value.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: value.reasoningEffort }),
      ...(value.maxReasoningTokens === undefined
        ? {}
        : { maxReasoningTokens: value.maxReasoningTokens }),
      ...(value.retainReasoningSummary === undefined
        ? {}
        : { retainReasoningSummary: value.retainReasoningSummary }),
    };
  }
  return result;
}

function compactCapabilityRequest(input: {
  selected?: boolean | undefined;
  reasoningMode?: "off" | "auto" | "summary" | undefined;
  reasoningEffort?: "low" | "medium" | "high" | undefined;
  maxReasoningTokens?: number | undefined;
  retainReasoningSummary?: boolean | undefined;
}): CapabilityRequestedValues {
  return {
    ...(input.selected === undefined ? {} : { selected: input.selected }),
    ...(input.reasoningMode === undefined
      ? {}
      : { reasoningMode: input.reasoningMode }),
    ...(input.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: input.reasoningEffort }),
    ...(input.maxReasoningTokens === undefined
      ? {}
      : { maxReasoningTokens: input.maxReasoningTokens }),
    ...(input.retainReasoningSummary === undefined
      ? {}
      : { retainReasoningSummary: input.retainReasoningSummary }),
  };
}
