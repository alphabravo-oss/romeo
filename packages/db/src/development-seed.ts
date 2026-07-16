import { defaultProviderCapabilities } from "@romeo/providers";

import type { RomeoDatabase } from "./client";
import {
  agentKnowledgeBindings,
  agentModels,
  agentToolBindings,
  agentVersions,
  baseModels,
  chats,
  groups,
  groupMemberships,
  knowledgeBases,
  organizations,
  providerInstances,
  quotaBuckets,
  resourceGrants,
  retentionPolicies,
  users,
  voiceProfiles,
  workspaces,
} from "./schema";

export interface DevelopmentSeedResult {
  schemaVersion: "romeo.postgres-development-seed.v1";
  generatedAt: string;
  mode: "development";
  ensured: string[];
}

export async function seedPostgresDevelopmentData(
  db: RomeoDatabase,
  now = new Date(),
): Promise<DevelopmentSeedResult> {
  await db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values(defaultOrganization)
      .onConflictDoNothing();
    await tx.insert(workspaces).values(defaultWorkspace).onConflictDoNothing();
    await tx.insert(users).values(defaultAdminUser).onConflictDoNothing();
    await tx
      .insert(groups)
      .values(defaultAdminGroup(now))
      .onConflictDoNothing();
    await tx
      .insert(groupMemberships)
      .values(defaultAdminMembership(now))
      .onConflictDoNothing();
    await tx
      .insert(providerInstances)
      .values(defaultProviders)
      .onConflictDoNothing();
    await tx.insert(baseModels).values(defaultModels).onConflictDoNothing();
    await tx
      .insert(voiceProfiles)
      .values(defaultVoiceProfile(now))
      .onConflictDoNothing();
    await tx
      .insert(knowledgeBases)
      .values(defaultKnowledgeBase(now))
      .onConflictDoNothing();
    await tx
      .insert(agentModels)
      .values(defaultAgent(now))
      .onConflictDoNothing();
    await tx
      .insert(agentVersions)
      .values(defaultAgentVersion(now))
      .onConflictDoNothing();
    await tx
      .insert(agentKnowledgeBindings)
      .values(defaultAgentKnowledgeBinding(now))
      .onConflictDoNothing();
    await tx
      .insert(agentToolBindings)
      .values(defaultAgentToolBindings(now))
      .onConflictDoNothing();
    await tx.insert(chats).values(defaultChat(now)).onConflictDoNothing();
    await tx
      .insert(retentionPolicies)
      .values(defaultRetentionPolicy(now))
      .onConflictDoUpdate({
        target: retentionPolicies.orgId,
        set: {
          auditLogRetentionDays: 365,
          updatedBy: "user_dev_admin",
          updatedAt: now,
        },
      });
    await tx
      .insert(quotaBuckets)
      .values(defaultQuotaBucket(now))
      .onConflictDoNothing({
        target: [
          quotaBuckets.orgId,
          quotaBuckets.scopeType,
          quotaBuckets.scopeId,
          quotaBuckets.metric,
        ],
      });
    await tx
      .insert(resourceGrants)
      .values(defaultResourceGrants(now))
      .onConflictDoNothing({
        target: [
          resourceGrants.orgId,
          resourceGrants.resourceType,
          resourceGrants.resourceId,
          resourceGrants.principalType,
          resourceGrants.principalId,
          resourceGrants.permission,
        ],
      });
  });

  return {
    schemaVersion: "romeo.postgres-development-seed.v1",
    generatedAt: new Date().toISOString(),
    mode: "development",
    ensured: [
      "organization",
      "workspace",
      "admin_user",
      "admin_group",
      "providers",
      "models",
      "voice_profile",
      "knowledge_base",
      "agent",
      "chat",
      "retention_policy",
      "quota_bucket",
      "resource_grants",
    ],
  };
}

const openAiCapabilities = defaultProviderCapabilities("openai-compatible");
const ollamaCapabilities = defaultProviderCapabilities("ollama");

const defaultOrganization = {
  id: "org_default",
  name: "Romeo Local",
  slug: "romeo-local",
};

const defaultWorkspace = {
  id: "workspace_default",
  orgId: "org_default",
  name: "Default",
  slug: "default",
};

const defaultAdminUser = {
  id: "user_dev_admin",
  orgId: "org_default",
  email: "admin@romeo.local",
  name: "Romeo Admin",
};

const defaultProviders = [
  {
    id: "provider_openai_compatible",
    orgId: "org_default",
    type: "openai-compatible" as const,
    name: "OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    enabled: true,
    capabilities: openAiCapabilities,
  },
  {
    id: "provider_ollama",
    orgId: "org_default",
    type: "ollama" as const,
    name: "Local Ollama",
    baseUrl: "http://localhost:11434",
    enabled: true,
    capabilities: ollamaCapabilities,
  },
];

const defaultModels = [
  {
    id: "model_openai_compatible_default",
    orgId: "org_default",
    providerId: "provider_openai_compatible",
    name: "gpt-compatible",
    displayName: "OpenAI-compatible default",
    enabled: true,
    capabilities: openAiCapabilities,
    contextWindow: 128000,
  },
  {
    id: "model_ollama_default",
    orgId: "org_default",
    providerId: "provider_ollama",
    name: "llama3.2",
    displayName: "Ollama llama3.2",
    enabled: true,
    capabilities: ollamaCapabilities,
    contextWindow: 8192,
  },
];

function defaultAdminGroup(now: Date) {
  return {
    id: "group_admins",
    orgId: "org_default",
    name: "Admins",
    slug: "admins",
    createdAt: now,
  };
}

function defaultAdminMembership(now: Date) {
  return {
    groupId: "group_admins",
    userId: "user_dev_admin",
    orgId: "org_default",
    createdAt: now,
  };
}

function defaultVoiceProfile(now: Date) {
  return {
    id: "voice_default",
    orgId: "org_default",
    providerId: "voice_disabled",
    providerVoiceId: "disabled-default",
    name: "Romeo Neutral",
    language: "en",
    styleTags: ["neutral"],
    cloningAllowed: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultKnowledgeBase(now: Date) {
  return {
    id: "kb_default",
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: "Romeo Handbook",
    description: "Seed knowledge base for validating the RAG control plane.",
    createdBy: "user_dev_admin",
    createdAt: now,
    updatedAt: now,
  };
}

function defaultAgent(now: Date) {
  return {
    id: "agent_default",
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: "Romeo Assistant",
    slug: "romeo-assistant",
    baseModelId: "model_openai_compatible_default",
    systemPrompt: "You are Romeo, a secure AI workspace assistant.",
    parameters: { temperature: 0.2 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    voiceProfileId: "voice_default",
    publishedVersionId: "agent_version_default_v1",
    createdBy: "user_dev_admin",
    createdAt: now,
    updatedAt: now,
  };
}

function defaultAgentVersion(now: Date) {
  return {
    id: "agent_version_default_v1",
    agentId: "agent_default",
    orgId: "org_default",
    workspaceId: "workspace_default",
    version: 1,
    status: "published",
    baseModelId: "model_openai_compatible_default",
    systemPrompt: "You are Romeo, a secure AI workspace assistant.",
    parameters: { temperature: 0.2 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    voiceProfileId: "voice_default",
    knowledgeBaseBindings: [{ knowledgeBaseId: "kb_default", enabled: true }],
    // Must match defaultAgentToolBindings below: rolling back to this version
    // re-applies these bindings to the agent, which would otherwise silently
    // re-enable the tools this seed deliberately ships disabled.
    toolBindings: [
      { toolId: "tool_calculator", enabled: false, approvalRequired: false },
      { toolId: "tool_datetime", enabled: false, approvalRequired: true },
    ],
    createdBy: "user_dev_admin",
    createdAt: now,
    publishedAt: now,
  };
}

function defaultAgentKnowledgeBinding(now: Date) {
  return {
    id: "agent_knowledge_binding_default",
    orgId: "org_default",
    agentId: "agent_default",
    knowledgeBaseId: "kb_default",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

// Bindings ship attached but DISABLED, matching the in-memory seed in
// packages/core/src/repositories/seed-data.ts (the two must agree or Postgres
// and dev diverge). Agent Studio still shows tools wired to an agent, but the
// default agent advertises no tools to the model. Enabled by default they break
// the README's Ollama quick start on both common local models: llama3.2 fires
// tool_calculator on a bare "hi" with an empty expression and then confabulates
// a question around the result, which reads to users like context leaking from
// another chat; gemma3:4b cannot use tools at all and hard-errors "does not
// support tools". Turn a tool on per agent to use it.
function defaultAgentToolBindings(now: Date) {
  return [
    {
      id: "agent_tool_binding_calculator",
      orgId: "org_default",
      agentId: "agent_default",
      toolId: "tool_calculator",
      enabled: false,
      approvalRequired: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "agent_tool_binding_datetime",
      orgId: "org_default",
      agentId: "agent_default",
      toolId: "tool_datetime",
      enabled: false,
      approvalRequired: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function defaultChat(now: Date) {
  return {
    id: "chat_welcome",
    orgId: "org_default",
    workspaceId: "workspace_default",
    title: "Welcome",
    createdBy: "user_dev_admin",
    createdAt: now,
    updatedAt: now,
  };
}

function defaultRetentionPolicy(now: Date) {
  return {
    orgId: "org_default",
    auditLogRetentionDays: 365,
    updatedBy: "user_dev_admin",
    updatedAt: now,
  };
}

function defaultQuotaBucket(now: Date) {
  return {
    id: "quota_seed_run_started",
    orgId: "org_default",
    scopeType: "org" as const,
    scopeId: "org_default",
    metric: "run.started",
    limit: 1000000,
    used: 0,
    resetInterval: "monthly",
    resetAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultResourceGrants(now: Date) {
  const grants: Array<[string, string, "read" | "run" | "use" | "write"]> = [
    ["chat", "chat_welcome", "write"],
    ["agent", "agent_default", "run"],
    ["tool", "tool_calculator", "use"],
    ["tool", "tool_datetime", "use"],
    ["model", "model_openai_compatible_default", "use"],
    ["model", "model_ollama_default", "use"],
    ["provider", "provider_openai_compatible", "use"],
    ["provider", "provider_ollama", "use"],
    ["knowledge_base", "kb_default", "read"],
    ["knowledge_base", "kb_default", "use"],
    ["knowledge_base", "kb_default", "write"],
    ["voice_profile", "voice_default", "use"],
  ];

  return grants.map(([resourceType, resourceId, permission], index) => ({
    id: `grant_seed_${index + 1}`,
    orgId: "org_default",
    resourceType,
    resourceId,
    principalType: "group" as const,
    principalId: "group_admins",
    permission,
    createdAt: now,
  }));
}
