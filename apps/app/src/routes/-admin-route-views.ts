export type AdminProviderView =
  | "base-models"
  | "curated"
  | "observability"
  | "providers";
export type AdminUsageView = "consumption" | "quotas";
export type AdminAccessView = "keys" | "service-accounts";

export function resolveAdminProviderView(view?: string): AdminProviderView {
  if (view === "models") return "base-models";
  return isOneOf(view, ["providers", "base-models", "curated", "observability"])
    ? view
    : "providers";
}

export function resolveAdminUsageView(view?: string): AdminUsageView {
  return isOneOf(view, ["consumption", "quotas"]) ? view : "consumption";
}

export function resolveAdminAccessView(view?: string): AdminAccessView {
  return isOneOf(view, ["keys", "service-accounts"]) ? view : "keys";
}

function isOneOf<const Value extends string>(
  value: string | undefined,
  allowed: readonly Value[],
): value is Value {
  return value !== undefined && allowed.includes(value as Value);
}
