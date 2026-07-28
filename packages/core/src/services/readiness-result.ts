export interface ReadinessCheck {
  id: string;
  status: "fail" | "pass" | "warn";
  severity: "critical" | "info" | "warning";
  message: string;
  details: Record<string, unknown>;
}

export interface ReadinessReport {
  status: "attention_required" | "ready";
  generatedAt: string;
  checks: ReadinessCheck[];
}

export function pass(
  id: string,
  message: string,
  details: Record<string, unknown>,
): ReadinessCheck {
  return { id, status: "pass", severity: "info", message, details };
}

export function warn(
  id: string,
  message: string,
  details: Record<string, unknown>,
): ReadinessCheck {
  return { id, status: "warn", severity: "warning", message, details };
}

export function fail(
  id: string,
  severity: "critical",
  message: string,
  details: Record<string, unknown>,
): ReadinessCheck {
  return { id, status: "fail", severity, message, details };
}
