export type ByokProvider = "aws_kms" | "azure_key_vault" | "gcp_kms" | "self_hosted";

export function authorizeByokIntegration(input: {
  provider: ByokProvider;
  workloadIdentity: boolean;
  staticCloudKey: boolean;
}):
  | { outcome: "accepted"; provider: ByokProvider }
  | { outcome: "denied"; code: "tenant_key_unavailable" } {
  if (input.staticCloudKey || !input.workloadIdentity)
    return { outcome: "denied", code: "tenant_key_unavailable" };
  return { outcome: "accepted", provider: input.provider };
}

export function planTenantKeyRotation(input: {
  dualControl: boolean;
  bulkPlaintext: boolean;
  currentVersion: number;
}):
  | {
      outcome: "accepted";
      nextVersion: number;
      mixedKeyReads: true;
      resumable: true;
    }
  | { outcome: "denied"; code: "policy_bundle_approval_required" | "tenant_key_unavailable" } {
  if (input.bulkPlaintext)
    return { outcome: "denied", code: "tenant_key_unavailable" };
  if (!input.dualControl)
    return { outcome: "denied", code: "policy_bundle_approval_required" };
  return {
    outcome: "accepted",
    nextVersion: input.currentVersion + 1,
    mixedKeyReads: true,
    resumable: true,
  };
}

export function authorizeCryptoShred(input: {
  legalHold: boolean;
  backupChecked: boolean;
  approverIds: string[];
  actorId: string;
}):
  | { outcome: "accepted"; evidence: { keysDestroyed: true; externalCopiesClaimed: false } }
  | { outcome: "denied"; code: "data_deletion_legal_hold" | "policy_bundle_approval_required" } {
  if (input.legalHold || !input.backupChecked)
    return { outcome: "denied", code: "data_deletion_legal_hold" };
  const distinct = new Set(input.approverIds.filter((id) => id !== input.actorId));
  if (distinct.size < 1)
    return { outcome: "denied", code: "policy_bundle_approval_required" };
  return {
    outcome: "accepted",
    evidence: { keysDestroyed: true, externalCopiesClaimed: false },
  };
}

export function decideSearchVectorStrategy(input: {
  dataClass: "restricted" | "internal" | "public";
  customerHeldKey: boolean;
}): { mode: "disabled" | "scoped_index" | "available" } {
  if (input.customerHeldKey && input.dataClass === "restricted")
    return { mode: "disabled" };
  if (input.customerHeldKey) return { mode: "scoped_index" };
  return { mode: "available" };
}

export function assertRestoreIsolation(input: {
  tenantIsolated: boolean;
  revokedKeyHonored: boolean;
  auditChainIntact: boolean;
  deletionStatePreserved: boolean;
}):
  | { outcome: "accepted" }
  | { outcome: "denied"; code: "tenant_key_revoked" } {
  if (
    !input.tenantIsolated ||
    !input.revokedKeyHonored ||
    !input.auditChainIntact ||
    !input.deletionStatePreserved
  )
    return { outcome: "denied", code: "tenant_key_revoked" };
  return { outcome: "accepted" };
}
