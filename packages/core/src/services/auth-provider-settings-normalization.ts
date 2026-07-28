import { ApiError } from "../errors";
import { parseManagedSecretRef } from "./secret-refs";

export function normalizeOptionalText(
  patch: string | null | undefined,
  existing: string | undefined,
  fallback: string | undefined,
  maxLength: number,
): string | undefined {
  if (patch === undefined) return existing ?? fallback;
  if (patch === null) return fallback;
  const normalized = patch.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ApiError(
      "invalid_auth_provider_settings",
      "Authentication provider text fields must be non-empty and bounded.",
      400,
    );
  }
  return normalized;
}

export function normalizeOptionalInteger(
  patch: number | null | undefined,
  existing: number | undefined,
  min: number,
  max: number,
  label: string,
): number | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  if (!Number.isInteger(patch) || patch < min || patch > max) {
    throw new ApiError(
      "invalid_auth_provider_settings",
      `Authentication provider ${label} is out of range.`,
      400,
    );
  }
  return patch;
}

export function normalizeDomainPatch(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] {
  if (patch === undefined) return existing ?? [];
  if (patch === null) return [];
  const normalized = [
    ...new Set(
      patch.map((domain) => normalizeEmailDomain(domain)).filter(Boolean),
    ),
  ].sort();
  if (normalized.length > 100) {
    throw new ApiError(
      "invalid_auth_provider_settings",
      "Authentication provider allowed-domain lists are limited to 100 entries.",
      400,
    );
  }
  return normalized;
}

export function normalizeOptionalDomainPatch(
  patch: string[] | null | undefined,
  existing: string[] | undefined,
): string[] | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  return normalizeDomainPatch(patch, undefined);
}

function normalizeEmailDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const pattern = new RegExp(`^${label}(?:\\.${label})+$`, "u");
  if (!pattern.test(normalized)) {
    throw new ApiError(
      "invalid_auth_provider_allowed_domain",
      "Allowed email domains must be exact DNS domains.",
      400,
    );
  }
  return normalized;
}

export function normalizeSecretRefPatch(
  patch: string | null | undefined,
  existing: string | undefined,
): string | undefined {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const normalized = patch.trim();
  parseManagedSecretRef(normalized);
  return normalized;
}

export function parseSecretRef(
  secretRef: string | undefined,
): string | undefined {
  if (secretRef === undefined) return undefined;
  try {
    return parseManagedSecretRef(secretRef).scheme;
  } catch {
    return "invalid";
  }
}
