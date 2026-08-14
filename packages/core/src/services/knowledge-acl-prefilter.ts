export type KnowledgeAclMode =
  | "delegated_live"
  | "synchronized"
  | "workspace_only";

export interface KnowledgeAclBinding {
  sourceId: string;
  documentId: string;
  principalId: string;
  permission: "read" | "use";
  aclRevision: string;
  syncedAt: string;
  tombstoned?: boolean;
}

export interface KnowledgeAclCandidate {
  sourceId: string;
  documentId: string;
  aclRevision: string;
  syncedAt: string;
}

export interface KnowledgeAclDecision {
  allowed: KnowledgeAclCandidate[];
  deniedCount: number;
  reasonCode?:
    | "knowledge_acl_denied"
    | "knowledge_acl_stale"
    | "knowledge_acl_revoked"
    | "knowledge_acl_tombstoned";
}

export function prefilterKnowledgeCandidates(input: {
  candidates: KnowledgeAclCandidate[];
  bindings: KnowledgeAclBinding[];
  principalId: string;
  now: string;
  maxStalenessMs: number;
  failClosedWhenStale: boolean;
}): KnowledgeAclDecision {
  const allowedBindings = new Map(
    input.bindings
      .filter(
        (binding) =>
          binding.principalId === input.principalId &&
          binding.tombstoned !== true,
      )
      .map((binding) => [`${binding.sourceId}:${binding.documentId}`, binding]),
  );
  const allowed: KnowledgeAclCandidate[] = [];
  let deniedCount = 0;
  let reasonCode: KnowledgeAclDecision["reasonCode"];
  const now = Date.parse(input.now);
  for (const candidate of input.candidates) {
    const binding = allowedBindings.get(
      `${candidate.sourceId}:${candidate.documentId}`,
    );
    if (binding === undefined) {
      deniedCount += 1;
      reasonCode ??= "knowledge_acl_denied";
      continue;
    }
    if (binding.tombstoned === true) {
      deniedCount += 1;
      reasonCode = "knowledge_acl_tombstoned";
      continue;
    }
    if (
      input.failClosedWhenStale &&
      now - Date.parse(candidate.syncedAt) > input.maxStalenessMs
    ) {
      deniedCount += 1;
      reasonCode = "knowledge_acl_stale";
      continue;
    }
    allowed.push(candidate);
  }
  return {
    allowed,
    deniedCount,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

export function recheckKnowledgeAccess(input: {
  previouslyAllowed: KnowledgeAclCandidate[];
  bindings: KnowledgeAclBinding[];
  principalId: string;
  now: string;
  maxStalenessMs: number;
}): KnowledgeAclDecision {
  return prefilterKnowledgeCandidates({
    candidates: input.previouslyAllowed,
    bindings: input.bindings,
    principalId: input.principalId,
    now: input.now,
    maxStalenessMs: input.maxStalenessMs,
    failClosedWhenStale: true,
  });
}

export function knowledgeAclCacheKey(input: {
  subjectId: string;
  groupRevision: string;
  grantRevision: string;
  aclRevision: string;
}): string {
  return [
    input.subjectId,
    input.groupRevision,
    input.grantRevision,
    input.aclRevision,
  ].join("\0");
}
