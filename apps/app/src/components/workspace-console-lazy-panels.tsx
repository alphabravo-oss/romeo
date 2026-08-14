import { lazy } from "react";

function lazyNamed<
  T extends Record<K, React.ComponentType<any>>,
  K extends keyof T,
>(loader: () => Promise<T>, name: K) {
  return lazy(async () => ({ default: (await loader())[name] }));
}

const workspaceSectionLoaders = {
  agents: () => import("./AgentStudioPanel"),
  collaboration: () => import("./CollaborationPanel"),
  evals: () => import("./EvalPanel"),
  knowledge: () => import("./KnowledgePanel"),
  tools: () => import("./WorkspaceToolsSection"),
  voice: () => import("./VoicePanel"),
} as const;

export async function preloadWorkspaceSection(section: string): Promise<void> {
  if (!(section in workspaceSectionLoaders)) return;
  await workspaceSectionLoaders[
    section as keyof typeof workspaceSectionLoaders
  ]();
}

export const AgentStudioPanel = lazyNamed(
  workspaceSectionLoaders.agents,
  "AgentStudioPanel",
);
export const CollaborationPanel = lazyNamed(
  workspaceSectionLoaders.collaboration,
  "CollaborationPanel",
);
export const EvalPanel = lazyNamed(workspaceSectionLoaders.evals, "EvalPanel");
export const KnowledgePanel = lazyNamed(
  workspaceSectionLoaders.knowledge,
  "KnowledgePanel",
);
export const VoicePanel = lazyNamed(
  workspaceSectionLoaders.voice,
  "VoicePanel",
);
export const WorkspaceToolsSection = lazyNamed(
  workspaceSectionLoaders.tools,
  "WorkspaceToolsSection",
);
