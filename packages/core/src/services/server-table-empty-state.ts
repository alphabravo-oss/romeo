export type ServerTableEmptyReason =
  | "no_data"
  | "no_filter_matches"
  | "permission_lost"
  | "stale_cursor"
  | "transient_failure";

export function classifyServerTableEmptyState(input: {
  authorized: boolean;
  staleCursor: boolean;
  transientFailure: boolean;
  total: number;
  hasFilters: boolean;
}): ServerTableEmptyReason {
  if (!input.authorized) return "permission_lost";
  if (input.staleCursor) return "stale_cursor";
  if (input.transientFailure) return "transient_failure";
  if (input.total === 0 && input.hasFilters) return "no_filter_matches";
  return "no_data";
}

export function authorizeBulkSelection(input: {
  mode: "explicit_ids" | "all_matching_query";
  explicitCount: number;
  matchingCount: number;
  reauthorized: boolean;
}): { outcome: "accepted"; count: number } | { outcome: "denied"; code: "bulk_selection_reauthorization_required" } {
  if (!input.reauthorized)
    return { outcome: "denied", code: "bulk_selection_reauthorization_required" };
  return {
    outcome: "accepted",
    count:
      input.mode === "explicit_ids" ? input.explicitCount : input.matchingCount,
  };
}
