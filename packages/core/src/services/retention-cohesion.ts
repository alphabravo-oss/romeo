export const RETENTION_SURFACES = [
  "paging",
  "summaries",
  "search",
  "events",
  "exports",
  "caches",
] as const;
export type RetentionSurface = (typeof RETENTION_SURFACES)[number];

export type RetentionCohesionPlan =
  | {
      action: "retain";
      reason: "legal_hold" | "in_policy";
      surfaces: readonly RetentionSurface[];
    }
  | {
      action: "delete";
      reason: "retention_or_user_delete";
      surfaces: readonly RetentionSurface[];
    }
  | {
      action: "crypto_shred";
      reason: "approved_shred";
      surfaces: readonly RetentionSurface[];
    }
  | {
      action: "blocked";
      code:
        | "retention_hold_blocks_delete"
        | "retention_hold_blocks_shred"
        | "retention_backup_check_required";
    };

export function planRetentionCohesion(input: {
  legalHold: boolean;
  deleted: boolean;
  cryptoShredRequested: boolean;
  backupChecked: boolean;
}): RetentionCohesionPlan {
  if (input.legalHold) {
    if (input.cryptoShredRequested)
      return { action: "blocked", code: "retention_hold_blocks_shred" };
    if (input.deleted)
      return { action: "blocked", code: "retention_hold_blocks_delete" };
    return { action: "retain", reason: "legal_hold", surfaces: RETENTION_SURFACES };
  }
  if (input.cryptoShredRequested) {
    if (!input.backupChecked)
      return { action: "blocked", code: "retention_backup_check_required" };
    return {
      action: "crypto_shred",
      reason: "approved_shred",
      surfaces: RETENTION_SURFACES,
    };
  }
  if (input.deleted)
    return {
      action: "delete",
      reason: "retention_or_user_delete",
      surfaces: RETENTION_SURFACES,
    };
  return { action: "retain", reason: "in_policy", surfaces: RETENTION_SURFACES };
}

export function surfaceHonorsRetention(
  plan: RetentionCohesionPlan,
  surface: RetentionSurface,
): boolean {
  if (plan.action === "blocked") return true;
  return plan.surfaces.includes(surface);
}
