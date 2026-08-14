export interface RunContextManifest {
  schema: "romeo.run-context.v1";
  runId: string;
  messageIds: string[];
  checkpointIds: string[];
  knowledgeSourceIds: string[];
  toolIds: string[];
  policyVersions: string[];
}

export interface RunContextInspection {
  schema: "romeo.run-context.inspection.v1";
  runId: string;
  messageCount: number;
  checkpointCount: number;
  knowledgeSourceCount: number;
  toolCount: number;
  policyVersions: string[];
  hiddenReasoningIncluded: false;
}

export function buildRunContextManifest(input: {
  runId: string;
  messageIds: string[];
  checkpointIds: string[];
  knowledgeSourceIds: string[];
  toolIds: string[];
  policyVersions: string[];
}): RunContextManifest {
  return {
    schema: "romeo.run-context.v1",
    runId: input.runId,
    messageIds: [...input.messageIds],
    checkpointIds: [...input.checkpointIds],
    knowledgeSourceIds: [...input.knowledgeSourceIds],
    toolIds: [...input.toolIds],
    policyVersions: [...input.policyVersions],
  };
}

export function projectRunContextInspection(
  manifest: RunContextManifest,
  authorizedKnowledgeSourceIds: ReadonlySet<string>,
): RunContextInspection {
  return {
    schema: "romeo.run-context.inspection.v1",
    runId: manifest.runId,
    messageCount: manifest.messageIds.length,
    checkpointCount: manifest.checkpointIds.length,
    knowledgeSourceCount: manifest.knowledgeSourceIds.filter((id) =>
      authorizedKnowledgeSourceIds.has(id),
    ).length,
    toolCount: manifest.toolIds.length,
    policyVersions: [...manifest.policyVersions],
    hiddenReasoningIncluded: false,
  };
}
