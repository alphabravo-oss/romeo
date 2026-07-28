import { authProviderIds, type AuthProviderId } from "../domain/auth-providers";
import type { EffectiveAuthProviderSetting } from "../domain/auth-provider-settings";
import type { StoredOrgProviderOverride } from "./auth-provider-settings-storage-types";

export function settingsNotes(
  providers: EffectiveAuthProviderSetting[],
): string[] {
  const notes = [
    "Auth provider settings expose managed secret posture only; raw secret refs are not returned.",
  ];
  if (
    !providers.some(
      (provider) => provider.providerId === "local" && provider.enabled,
    )
  ) {
    notes.push(
      "Local auth fallback is disabled for this effective provider policy.",
    );
  }
  if (providers.some((provider) => provider.catalogStatus === "planned")) {
    notes.push(
      "Planned providers appear in the catalog but cannot be enabled until their adapters are implemented.",
    );
  }
  return notes;
}

export function isAuthProviderEntry(
  entry: [string, StoredOrgProviderOverride | undefined],
): entry is [AuthProviderId, StoredOrgProviderOverride] {
  return (
    authProviderIds.includes(entry[0] as AuthProviderId) &&
    entry[1] !== undefined
  );
}

export function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
