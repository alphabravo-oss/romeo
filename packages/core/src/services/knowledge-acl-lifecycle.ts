export function knowledgeAclCacheKey(input: {
  subjectId: string;
  groupVersion: string;
  grantVersion: string;
  aclVersion: string;
}): string {
  return [
    input.subjectId,
    input.groupVersion,
    input.grantVersion,
    input.aclVersion,
  ].join(":");
}

export function invalidateAclCaches(input: {
  revoked: boolean;
  caches: Array<"result" | "snippet" | "embedding" | "answer" | "citation">;
}): string[] {
  if (!input.revoked) return [];
  return [...input.caches];
}

export function evaluateAclFreshness(input: {
  sensitivity: "restricted" | "internal" | "public";
  ageMs: number;
  maxStalenessMs: number;
}):
  | { outcome: "fresh" }
  | { outcome: "stale"; failClosed: boolean; code?: "knowledge_acl_stale" } {
  if (input.ageMs <= input.maxStalenessMs) return { outcome: "fresh" };
  if (input.sensitivity === "restricted")
    return { outcome: "stale", failClosed: true, code: "knowledge_acl_stale" };
  return { outcome: "stale", failClosed: false };
}

export function planKnowledgeTombstone(input: {
  legalHold: boolean;
  surfaces: Array<
    "primary" | "vector" | "keyword" | "cache" | "snippet" | "summary" | "retrieval"
  >;
}):
  | { outcome: "accepted"; surfaces: typeof input.surfaces }
  | { outcome: "denied"; code: "chat_delete_legal_hold" } {
  if (input.legalHold)
    return { outcome: "denied", code: "chat_delete_legal_hold" };
  return { outcome: "accepted", surfaces: [...input.surfaces] };
}

export function summarizeAclMonitoring(input: {
  syncLagMs: number;
  unresolvedPrincipals: number;
  staleSources: number;
  deletionBacklog: number;
  deniedRetrieval: number;
  externalFilterConforming: boolean;
}): {
  syncLagMs: number;
  unresolvedPrincipals: number;
  staleSources: number;
  deletionBacklog: number;
  deniedRetrieval: number;
  externalFilterConforming: boolean;
  syntheticProbe: false;
} {
  return { ...input, syntheticProbe: false };
}
