export const auditCategories = [
  "security",
  "admin",
  "access",
  "data",
  "chat",
  "run",
  "system",
] as const;

export type AuditCategory = (typeof auditCategories)[number];

const AUDIT_NOISE_ACTIONS = new Set([
  "billing.entitlements_reconciled",
  "billing.external_event_synced",
  "chat.temporary.cleanup",
  "chat.temporary.cleanup.worker",
  "knowledge.embedding.index",
  "model.request",
  "provider.models.sync",
  "tool.connector.auth.check",
  "worker.enqueue",
]);

export function isAuditNoiseAction(action: string): boolean {
  return AUDIT_NOISE_ACTIONS.has(action);
}

export function isAuditNoise(log: {
  action: string;
  outcome: "failure" | "success";
}): boolean {
  return log.outcome !== "failure" && isAuditNoiseAction(log.action);
}

export function classifyAuditAction(action: string): AuditCategory {
  if (isAuditNoiseAction(action)) return "system";
  if (
    action.startsWith("local_auth.") ||
    action.startsWith("auth.") ||
    action.startsWith("support.") ||
    action.startsWith("scim.") ||
    action.startsWith("directory_sync.") ||
    action.includes("impersonat")
  ) {
    return "security";
  }
  if (
    action.includes("share") ||
    action.includes("grant") ||
    action.includes("favorite") ||
    action.startsWith("group.") ||
    action.startsWith("api_key.") ||
    action.startsWith("service_account.")
  ) {
    return "access";
  }
  if (
    action.startsWith("knowledge.") ||
    action.startsWith("file.") ||
    action.startsWith("connector.") ||
    action.startsWith("folder.")
  ) {
    return "data";
  }
  if (action.startsWith("chat.") || action.startsWith("chat_experience.")) {
    return "chat";
  }
  if (
    action.startsWith("run.") ||
    action.startsWith("tool.") ||
    action.startsWith("eval.") ||
    action.startsWith("workflow.") ||
    action.startsWith("voice.") ||
    action.startsWith("web_search.query") ||
    action.startsWith("web_url.")
  ) {
    return "run";
  }
  if (action.startsWith("worker.")) return "system";
  if (
    action.startsWith("admin.") ||
    action.startsWith("provider.") ||
    action.startsWith("model.") ||
    action.startsWith("governance.") ||
    action.startsWith("billing.") ||
    action.startsWith("quota.") ||
    action.startsWith("abuse") ||
    action.startsWith("web_search.configuration")
  ) {
    return "admin";
  }
  return "admin";
}

export function isSystemAuditActor(actorId: string): boolean {
  return (
    actorId.startsWith("system_") || actorId.includes("service_account_audit")
  );
}
