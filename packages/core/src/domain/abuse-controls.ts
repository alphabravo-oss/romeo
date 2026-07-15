import type { BillingPlan } from "./entities";

export type AbuseControlAction =
  | "connector.sync"
  | "eval.run"
  | "file.upload"
  | "knowledge.ingest"
  | "model.request"
  | "run.start"
  | "tool.dispatch"
  | "tool.execute"
  | "voice.request"
  | "workflow.run"
  | "worker.enqueue";

export type AbuseControlBlockReason =
  | "billing_plan_missing"
  | "billing_status_blocked"
  | "connector_kill_switch"
  | "org_suspended"
  | "provider_kill_switch"
  | "tool_kill_switch"
  | "worker_class_kill_switch";

export interface AbuseControlEntitlements {
  enforceBillingStatus: boolean;
  denyWhenBillingPlanMissing: boolean;
  allowedBillingStatuses: BillingPlan["status"][];
}

export interface AbuseControlKillSwitches {
  connectorIds: string[];
  providerIds: string[];
  toolIds: string[];
  workerClasses: string[];
}

export interface AbuseControlSuspension {
  suspended: boolean;
  reasonCode?: string;
  suspendedAt?: string;
  suspendedBy?: string;
}

export interface AbuseControlPolicyReport {
  orgId: string;
  source: "default" | "org";
  generatedAt: string;
  suspension: AbuseControlSuspension;
  entitlements: AbuseControlEntitlements;
  killSwitches: AbuseControlKillSwitches;
  enforcement: {
    billingPlanConfigured: boolean;
    billingPlanCode?: string;
    billingStatus?: BillingPlan["status"];
    costWorkBlocked: boolean;
    defaultBlockReasons: AbuseControlBlockReason[];
    activeKillSwitchCount: number;
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateAbuseControlPolicyRequest {
  suspension?: {
    suspended?: boolean;
    reasonCode?: string | null;
  };
  entitlements?: {
    enforceBillingStatus?: boolean;
    denyWhenBillingPlanMissing?: boolean;
    allowedBillingStatuses?: BillingPlan["status"][];
  };
  killSwitches?: {
    connectorIds?: string[];
    providerIds?: string[];
    toolIds?: string[];
    workerClasses?: string[];
  };
}
