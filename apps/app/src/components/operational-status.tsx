import type { MessageKey } from "../lib/i18n";

type Translate = (key: MessageKey) => string;

const operationalStatusKeys: Record<string, MessageKey> = {
  attention_required: "opAttentionRequired",
  blocked: "opBlocked",
  critical: "opFailed",
  degraded: "opDegraded",
  failed: "opFailed",
  healthy: "opHealthy",
  invalid: "opInvalid",
  not_configured: "opNotConfigured",
  not_run: "opNotRun",
  partial: "opPartial",
  passed: "opPassed",
  ready: "opReady",
  satisfied: "opPassed",
  unknown: "opUnknown",
};

export function OperationalStatusDot({
  status,
}: {
  status: "pass" | "warn" | "fail";
}): React.ReactNode {
  return <span className={`rm-status-dot ${status}`} />;
}

export function operationalStatusLabel(status: string, t: Translate): string {
  const key = operationalStatusKeys[status];
  return key === undefined ? humanizeOperationalCode(status) : t(key);
}

export function humanizeOperationalCode(code: string): string {
  const words = code.replaceAll("_", " ").trim();
  return words.length === 0
    ? code
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function jobStatusDot(
  status: "critical" | "degraded" | "healthy",
): "pass" | "warn" | "fail" {
  if (status === "healthy") return "pass";
  if (status === "critical") return "fail";
  return "warn";
}

export function quotaHealthDot(
  healthy: boolean | null,
): "pass" | "warn" | "fail" {
  if (healthy === null) return "warn";
  return healthy ? "pass" : "fail";
}
