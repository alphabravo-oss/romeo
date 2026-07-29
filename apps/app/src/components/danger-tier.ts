/**
 * Confirmation friction matched to an action's blast radius.
 *
 * - high: irreversible or organization-wide; typed confirmation
 * - medium: reversible but disruptive; danger-toned confirmation
 * - low: trivially reversible; no destructive styling
 */
export type DangerTier = "low" | "medium" | "high";

export function requiresTypedConfirmation(tier: DangerTier): boolean {
  return tier === "high";
}

export function confirmTone(tier: DangerTier): "default" | "danger" {
  return tier === "low" ? "default" : "danger";
}
