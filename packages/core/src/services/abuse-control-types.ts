import type {
  AbuseControlAction,
  AbuseControlEntitlements,
  AbuseControlKillSwitches,
  AbuseControlSuspension,
} from "../domain/abuse-controls";

export interface StoredAbuseControlPolicy {
  version: 1;
  orgId: string;
  suspension: AbuseControlSuspension;
  entitlements: AbuseControlEntitlements;
  killSwitches: AbuseControlKillSwitches;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AbuseControlEnforcementInput {
  action: AbuseControlAction;
  agentId?: string;
  connectorId?: string;
  providerId?: string;
  toolId?: string;
  workerClass?: string;
  workspaceId?: string;
}
