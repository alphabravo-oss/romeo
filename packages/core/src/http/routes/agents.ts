import type {
  AgentMemoryPolicy,
  AgentPromptSuggestion,
  AgentSafetySettings,
} from "../../domain/entities";
import {
  clearManagedModelPreferencesRoute,
  cloneManagedModelRoute,
  createManagedModelRoute,
  deleteManagedModelRoute,
  diffManagedModelVersionRoute,
  exportManagedModelRoute,
  getManagedModelReadinessRoute,
  getManagedModelCustomizationPolicyRoute,
  getManagedModelPreferencesRoute,
  getManagedModelRoute,
  importManagedModelRoute,
  listManagedModelsRoute,
  listManagedModelVersionsRoute,
  publishManagedModelRoute,
  rollbackManagedModelVersionRoute,
  updateManagedModelCustomizationPolicyRoute,
  updateManagedModelPreferencesRoute,
  updateManagedModelRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerAgentRoutes(app: RomeoApi): void {
  app.openapi(listManagedModelsRoute, async (context) => {
    const subject = context.get("subject");
    const workspaceId =
      context.req.valid("query").workspaceId ?? subject.workspaceIds[0];
    const data = workspaceId
      ? await context.get("services").agents.list(workspaceId, subject)
      : [];
    return context.json({ data }, 200);
  });

  app.openapi(createManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      workspaceId: string;
      name: string;
      description?: string;
      icon?: string;
      avatarUrl?: string;
      baseModelId: string;
      systemPrompt: string;
      parameters?: Record<string, unknown>;
      memoryPolicy?: AgentMemoryPolicy;
      promptSuggestions?: AgentPromptSuggestion[];
      safetySettings?: AgentSafetySettings;
      tags?: string[];
    } = {
      subject,
      workspaceId: body.workspaceId,
      name: body.name,
      baseModelId: body.baseModelId,
      systemPrompt: body.systemPrompt,
    };
    if (body.description !== undefined) input.description = body.description;
    if (body.icon !== undefined) input.icon = body.icon;
    if (body.avatarUrl !== undefined) input.avatarUrl = body.avatarUrl;
    if (body.parameters !== undefined) input.parameters = body.parameters;
    if (body.memoryPolicy !== undefined)
      input.memoryPolicy = compactMemoryPolicy(body.memoryPolicy);
    if (body.promptSuggestions !== undefined)
      input.promptSuggestions = body.promptSuggestions;
    if (body.safetySettings !== undefined)
      input.safetySettings = compactSafetySettings(body.safetySettings);
    if (body.tags !== undefined) input.tags = body.tags;

    const data = await context.get("services").agents.create(input);
    return context.json({ data }, 201);
  });

  app.openapi(getManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const data = await context.get("services").agents.get(agentId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(getManagedModelReadinessRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const query = context.req.valid("query");
    const data = await context.get("services").agents.readiness({
      agentId,
      subject,
      ...(query.principalType === undefined
        ? {}
        : { principalType: query.principalType }),
      ...(query.principalId === undefined
        ? {}
        : { principalId: query.principalId }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(updateManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      agentId: string;
      name?: string;
      description?: string;
      icon?: string;
      avatarUrl?: string;
      baseModelId?: string;
      systemPrompt?: string;
      parameters?: Record<string, unknown>;
      memoryPolicy?: AgentMemoryPolicy;
      promptSuggestions?: AgentPromptSuggestion[];
      safetySettings?: AgentSafetySettings;
      tags?: string[];
    } = { subject, agentId };
    if (body.name !== undefined) input.name = body.name;
    if (body.description !== undefined) input.description = body.description;
    if (body.icon !== undefined) input.icon = body.icon;
    if (body.avatarUrl !== undefined) input.avatarUrl = body.avatarUrl;
    if (body.baseModelId !== undefined) input.baseModelId = body.baseModelId;
    if (body.systemPrompt !== undefined) input.systemPrompt = body.systemPrompt;
    if (body.parameters !== undefined) input.parameters = body.parameters;
    if (body.memoryPolicy !== undefined)
      input.memoryPolicy = compactMemoryPolicy(body.memoryPolicy);
    if (body.promptSuggestions !== undefined)
      input.promptSuggestions = body.promptSuggestions;
    if (body.safetySettings !== undefined)
      input.safetySettings = compactSafetySettings(body.safetySettings);
    if (body.tags !== undefined) input.tags = body.tags;

    const data = await context.get("services").agents.update(input);
    return context.json({ data }, 200);
  });

  app.openapi(deleteManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const data = await context.get("services").agents.archive(agentId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(cloneManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      agentId: string;
      includeKnowledgeBindings?: boolean;
      name?: string;
      systemPrompt?: string;
    } = {
      subject,
      agentId,
    };
    if (body.includeKnowledgeBindings !== undefined)
      input.includeKnowledgeBindings = body.includeKnowledgeBindings;
    if (body.name !== undefined) input.name = body.name;
    if (body.systemPrompt !== undefined) input.systemPrompt = body.systemPrompt;

    const data = await context.get("services").agents.clone(input);
    return context.json({ data }, 201);
  });

  app.openapi(getManagedModelCustomizationPolicyRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .agents.getCustomizationPolicy(agentId, context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(updateManagedModelCustomizationPolicyRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .agents.updateCustomizationPolicy({
        agentId,
        subject: context.get("subject"),
        policy: {
          ...(body.allowCommunicationStyle === undefined
            ? {}
            : { allowCommunicationStyle: body.allowCommunicationStyle }),
          ...(body.allowResponseLength === undefined
            ? {}
            : { allowResponseLength: body.allowResponseLength }),
          ...(body.allowLanguage === undefined
            ? {}
            : { allowLanguage: body.allowLanguage }),
          ...(body.allowCustomInstructions === undefined
            ? {}
            : { allowCustomInstructions: body.allowCustomInstructions }),
          ...(body.allowPersonalMemory === undefined
            ? {}
            : { allowPersonalMemory: body.allowPersonalMemory }),
          ...(body.allowVoiceSelection === undefined
            ? {}
            : { allowVoiceSelection: body.allowVoiceSelection }),
        },
      });
    return context.json({ data }, 200);
  });

  app.openapi(getManagedModelPreferencesRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .agents.getPreferences(agentId, context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(updateManagedModelPreferencesRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").agents.updatePreferences({
      agentId,
      subject: context.get("subject"),
      preferences: {
        ...(body.communicationStyle === undefined
          ? {}
          : { communicationStyle: body.communicationStyle }),
        ...(body.responseLength === undefined
          ? {}
          : { responseLength: body.responseLength }),
        ...(body.language === undefined ? {} : { language: body.language }),
        ...(body.customInstructions === undefined
          ? {}
          : { customInstructions: body.customInstructions }),
        ...(body.personalMemoryEnabled === undefined
          ? {}
          : { personalMemoryEnabled: body.personalMemoryEnabled }),
        ...(body.voiceProfileId === undefined
          ? {}
          : { voiceProfileId: body.voiceProfileId }),
      },
    });
    return context.json({ data }, 200);
  });

  app.openapi(clearManagedModelPreferencesRoute, async (context) => {
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .agents.clearPreferences(agentId, context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(exportManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .agents.exportAgent(agentId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(importManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const agent = {
      name: body.document.agent.name,
      baseModelId: body.document.agent.baseModelId,
      systemPrompt: body.document.agent.systemPrompt,
      parameters: body.document.agent.parameters,
      memoryPolicy: compactMemoryPolicy(body.document.agent.memoryPolicy),
      promptSuggestions: body.document.agent.promptSuggestions,
      safetySettings: compactSafetySettings(body.document.agent.safetySettings),
      tags: body.document.agent.tags,
      ...(body.document.agent.accessGrants === undefined
        ? {}
        : { accessGrants: body.document.agent.accessGrants }),
      ...(body.document.agent.knowledgeBaseBindings === undefined
        ? {}
        : {
            knowledgeBaseBindings: body.document.agent.knowledgeBaseBindings,
          }),
      ...(body.document.agent.toolBindings === undefined
        ? {}
        : { toolBindings: body.document.agent.toolBindings }),
      ...(body.document.agent.voiceProfileId === undefined
        ? {}
        : { voiceProfileId: body.document.agent.voiceProfileId }),
    };
    const data = await context.get("services").agents.importAgent({
      subject,
      workspaceId: body.workspaceId,
      agent,
    });
    return context.json({ data }, 201);
  });

  app.openapi(listManagedModelVersionsRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const data = await context
      .get("services")
      .agents.listVersions(agentId, subject);
    return context.json({ data }, 200);
  });

  app.openapi(publishManagedModelRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const data = await context.get("services").agents.publish(agentId, subject);
    return context.json({ data }, 201);
  });

  app.openapi(diffManagedModelVersionRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId, versionId } = context.req.valid("param");
    const { compareTo } = context.req.valid("query");
    const data = await context.get("services").agents.diff({
      subject,
      agentId,
      leftVersionId: versionId,
      rightVersionId: compareTo,
    });
    return context.json({ data }, 200);
  });

  app.openapi(rollbackManagedModelVersionRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId, versionId } = context.req.valid("param");
    const data = await context.get("services").agents.rollback({
      subject,
      agentId,
      versionId,
    });
    return context.json({ data }, 200);
  });
}

function compactSafetySettings(input: {
  maxUserInputLength?: number | undefined;
  blockedTerms?: string[] | undefined;
  knowledgeGroundingMode?: "optional" | "prefer" | "required" | undefined;
  promptInjectionGuard?:
    | {
        mode: "disabled" | "block";
        scanUserInput?: boolean | undefined;
        scanRetrievedContext?: boolean | undefined;
      }
    | undefined;
}): AgentSafetySettings {
  const settings: AgentSafetySettings = {};
  if (input.maxUserInputLength !== undefined)
    settings.maxUserInputLength = input.maxUserInputLength;
  if (input.blockedTerms !== undefined)
    settings.blockedTerms = input.blockedTerms;
  if (
    input.knowledgeGroundingMode === "optional" ||
    input.knowledgeGroundingMode === "prefer" ||
    input.knowledgeGroundingMode === "required"
  ) {
    settings.knowledgeGroundingMode = input.knowledgeGroundingMode;
  }
  if (
    input.promptInjectionGuard !== undefined &&
    input.promptInjectionGuard.mode === "block"
  ) {
    settings.promptInjectionGuard = {
      mode: "block",
      scanUserInput: input.promptInjectionGuard.scanUserInput ?? true,
      scanRetrievedContext:
        input.promptInjectionGuard.scanRetrievedContext ?? true,
    };
  }
  return settings;
}

function compactMemoryPolicy(
  input:
    | { mode: "disabled" }
    | { mode: "recent_messages"; maxMessages?: number | undefined },
): AgentMemoryPolicy {
  if (input.mode === "disabled") return { mode: "disabled" };
  const policy: AgentMemoryPolicy = { mode: "recent_messages" };
  if (input.maxMessages !== undefined) policy.maxMessages = input.maxMessages;
  return policy;
}
