export interface ConnectorAclCapability {
  connectorId: string;
  documentAcl: boolean;
  userAcl: boolean;
  groupAcl: boolean;
  delegatedQuery: boolean;
  freshness: "live" | "synchronized" | "unknown";
  deletion: "tombstone" | "hard" | "unknown";
  failBehavior: "fail_closed" | "fail_open";
}

export function declareConnectorAclCapability(
  input: ConnectorAclCapability,
):
  | { outcome: "accepted"; capability: ConnectorAclCapability }
  | { outcome: "denied"; code: "connector_acl_fail_open_forbidden" } {
  if (
    (input.documentAcl || input.userAcl || input.groupAcl) &&
    input.failBehavior === "fail_open"
  )
    return { outcome: "denied", code: "connector_acl_fail_open_forbidden" };
  return { outcome: "accepted", capability: { ...input } };
}

export function mapExternalPrincipal(input: {
  externalId?: string;
  displayName?: string;
  email?: string;
}):
  | { outcome: "mapped"; principalKind: "immutable_id"; principalId: string }
  | { outcome: "unresolved"; code: "principal_id_required" } {
  const id = input.externalId?.trim();
  if (id === undefined || id.length === 0)
    return { outcome: "unresolved", code: "principal_id_required" };
  return { outcome: "mapped", principalKind: "immutable_id", principalId: id };
}

export function explainKnowledgeAccess(input: {
  allowed: boolean;
  aclRevision: string;
  grantVersion: string;
  principalId: string;
  documentTitle?: string;
}): {
  audience: "user" | "admin";
  allowed: boolean;
  aclRevision: string;
  grantVersion: string;
} {
  void input.principalId;
  void input.documentTitle;
  return {
    audience: "user",
    allowed: input.allowed,
    aclRevision: input.aclRevision,
    grantVersion: input.grantVersion,
  };
}
