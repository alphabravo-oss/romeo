const PLATFORM_MANDATORY_CONTROLS = [
  "content_firewall",
  "knowledge_acl",
  "tenant_encryption",
] as const;

export const BREAK_GLASS_MAX_TTL_MINUTES = 240;

export type BreakGlassDenial =
  | "break_glass_mandatory_control"
  | "break_glass_reason_required"
  | "break_glass_self_approval"
  | "break_glass_ttl_exceeded";

export function authorizeBreakGlass(input: {
  actorId: string;
  approverId: string;
  now: string;
  reason: string;
  requestedControls: readonly string[];
  ttlMinutes: number;
}):
  | {
      outcome: "accepted";
      alerted: true;
      expiresAt: string;
      ttlMinutes: number;
    }
  | { outcome: "denied"; code: BreakGlassDenial } {
  if (input.reason.trim().length < 8)
    return { outcome: "denied", code: "break_glass_reason_required" };
  if (input.actorId === input.approverId)
    return { outcome: "denied", code: "break_glass_self_approval" };
  if (
    !Number.isInteger(input.ttlMinutes) ||
    input.ttlMinutes < 1 ||
    input.ttlMinutes > BREAK_GLASS_MAX_TTL_MINUTES
  )
    return { outcome: "denied", code: "break_glass_ttl_exceeded" };
  if (
    input.requestedControls.some((control) =>
      (PLATFORM_MANDATORY_CONTROLS as readonly string[]).includes(control),
    )
  )
    return { outcome: "denied", code: "break_glass_mandatory_control" };
  return {
    alerted: true,
    expiresAt: new Date(
      Date.parse(input.now) + input.ttlMinutes * 60_000,
    ).toISOString(),
    outcome: "accepted",
    ttlMinutes: input.ttlMinutes,
  };
}

export function breakGlassExpired(input: {
  expiresAt: string;
  now: string;
}): boolean {
  return Date.parse(input.now) >= Date.parse(input.expiresAt);
}
