import type { Agent, AgentVersion } from "../features/managed-models/types";

export const agentStudioTabs = [
  "overview",
  "behavior",
  "capabilities",
  "knowledge",
  "tools",
  "voice",
  "access",
  "versions",
] as const;

export type AgentStudioTab = (typeof agentStudioTabs)[number];

export function resolveAgentStudioTab(
  value: string | undefined,
): AgentStudioTab {
  return agentStudioTabs.includes(value as AgentStudioTab)
    ? (value as AgentStudioTab)
    : "overview";
}

export function agentStudioTabLabel(tab: AgentStudioTab) {
  return {
    access: "agentTabAccess",
    behavior: "agentTabBehavior",
    capabilities: "agentTabCapabilities",
    knowledge: "agentTabKnowledge",
    overview: "agentTabOverview",
    tools: "agentTabTools",
    versions: "agentTabVersions",
    voice: "agentTabVoice",
  }[tab] as
    | "agentTabAccess"
    | "agentTabBehavior"
    | "agentTabCapabilities"
    | "agentTabKnowledge"
    | "agentTabOverview"
    | "agentTabTools"
    | "agentTabVersions"
    | "agentTabVoice";
}

export function changedPublishedFields(
  agent: Agent | undefined,
  version: AgentVersion | undefined,
): string[] {
  if (!agent || !version) return [];
  const candidates: Array<[string, unknown, unknown]> = [
    ["Base model", agent.baseModelId, version.baseModelId],
    ["System prompt", agent.systemPrompt, version.systemPrompt],
    ["Parameters", agent.parameters, version.parameters],
    ["Memory", agent.memoryPolicy, version.memoryPolicy],
    ["Safety", agent.safetySettings, version.safetySettings],
    [
      "Starter prompts",
      agent.promptSuggestions ?? [],
      version.promptSuggestions ?? [],
    ],
    ["Tags", agent.tags ?? [], version.tags ?? []],
    ["Voice", agent.voiceProfileId ?? null, version.voiceProfileId ?? null],
  ];
  return candidates
    .filter(
      ([, draft, published]) => stableJson(draft) !== stableJson(published),
    )
    .map(([label]) => label);
}

export function equivalentEditorLocation(
  current: { pathname: string; search: unknown },
  next: { pathname: string; search: unknown },
): boolean {
  if (current.pathname !== next.pathname) return false;
  return (
    stableJson(withoutEditorTab(current.search)) ===
    stableJson(withoutEditorTab(next.search))
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableObject(value));
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableObject(item)]),
  );
}

function withoutEditorTab(search: unknown): Record<string, unknown> {
  const value =
    typeof search === "object" && search !== null
      ? { ...(search as Record<string, unknown>) }
      : {};
  delete value.managedModelTab;
  delete value.tab;
  return value;
}
