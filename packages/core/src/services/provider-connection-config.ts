import type { ProviderKind } from "@romeo/providers";

import { ApiError } from "../errors";
import {
  resolveFirstClassProviderTarget,
  type FirstClassProviderTarget,
  type ProviderAuthStrategy,
} from "./provider-adapter-contracts";
import {
  validateRegionalEndpoint,
  type TenantResidency,
} from "./provider-endpoint-policy";
import { parseManagedSecretRef } from "./secret-refs";

const RAW_SECRET_PATTERN = /^(sk-|rk-|Bearer\s|api[_-]?key=)/iu;

export type ProviderConnectionConfigDenial =
  | "provider_auth_unsupported"
  | "provider_credential_required"
  | "provider_field_invalid"
  | "provider_raw_secret_forbidden"
  | "provider_region_outside_residency"
  | "provider_secret_ref_invalid"
  | "provider_target_unsupported";

export interface ProviderConnectionConfigInput {
  auth?: string;
  baseUrl: string;
  credentialAlreadyConfigured?: boolean;
  credentialRef?: string;
  deployment?: string;
  kind: ProviderKind;
  modelIds?: string[];
  name: string;
  project?: string;
  region?: string;
  target?: string;
  tenantResidency?: TenantResidency;
}

export interface SanitizedProviderConnectionConfig {
  auth?: ProviderAuthStrategy;
  baseUrl: string;
  credentialMode: "write_only";
  credentialRef?: string;
  deployment?: string;
  kind: ProviderKind;
  modelIds?: string[];
  name: string;
  project?: string;
  region?: string;
  target?: FirstClassProviderTarget;
}

export function validateProviderConnectionConfig(
  input: ProviderConnectionConfigInput,
):
  | { config: SanitizedProviderConnectionConfig; outcome: "accepted" }
  | { code: ProviderConnectionConfigDenial; outcome: "denied" } {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200)
    return { code: "provider_field_invalid", outcome: "denied" };
  let baseUrl: URL;
  try {
    baseUrl = new URL(input.baseUrl);
  } catch {
    return { code: "provider_field_invalid", outcome: "denied" };
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:")
    return { code: "provider_field_invalid", outcome: "denied" };
  if (input.modelIds !== undefined && input.modelIds.length > 2_000)
    return { code: "provider_field_invalid", outcome: "denied" };

  const credentialRequired =
    input.kind === "anthropic" && input.credentialAlreadyConfigured !== true;
  if (credentialRequired && input.credentialRef === undefined)
    return { code: "provider_credential_required", outcome: "denied" };
  if (input.credentialRef !== undefined) {
    if (RAW_SECRET_PATTERN.test(input.credentialRef.trim()))
      return { code: "provider_raw_secret_forbidden", outcome: "denied" };
    try {
      parseManagedSecretRef(input.credentialRef);
    } catch {
      return { code: "provider_secret_ref_invalid", outcome: "denied" };
    }
  }

  let target: FirstClassProviderTarget | undefined;
  let auth: ProviderAuthStrategy | undefined;
  if (input.target !== undefined || input.auth !== undefined) {
    const resolved = resolveFirstClassProviderTarget({
      auth: input.auth ?? defaultAuthForKind(input.kind),
      target: input.target ?? defaultTargetForKind(input.kind),
    });
    if (resolved.outcome === "denied")
      return { code: resolved.code, outcome: "denied" };
    target = resolved.target;
    auth = resolved.auth;
  }

  let region: string | undefined;
  let project: string | undefined;
  let deployment: string | undefined;
  if (input.region !== undefined) {
    const allowed = validateRegionalEndpoint({
      region: input.region,
      tenantResidency: input.tenantResidency ?? "unrestricted",
      ...(input.project === undefined ? {} : { project: input.project }),
      ...(input.deployment === undefined
        ? {}
        : { deployment: input.deployment }),
    });
    if (allowed.outcome === "denied")
      return { code: allowed.code, outcome: "denied" };
    region = allowed.region;
    project = allowed.project;
    deployment = allowed.deployment;
  }

  return {
    config: {
      baseUrl: baseUrl.toString(),
      credentialMode: "write_only",
      kind: input.kind,
      name,
      ...(auth === undefined ? {} : { auth }),
      ...(input.credentialRef === undefined
        ? {}
        : { credentialRef: input.credentialRef }),
      ...(deployment === undefined ? {} : { deployment }),
      ...(input.modelIds === undefined ? {} : { modelIds: input.modelIds }),
      ...(project === undefined ? {} : { project }),
      ...(region === undefined ? {} : { region }),
      ...(target === undefined ? {} : { target }),
    },
    outcome: "accepted",
  };
}

function defaultTargetForKind(kind: ProviderKind): string {
  if (kind === "anthropic") return "anthropic";
  if (kind === "ollama") return "ollama";
  return "openai-compatible";
}

function defaultAuthForKind(kind: ProviderKind): string {
  return kind === "ollama" ? "none" : "api_key";
}

export function requireAcceptedProviderConnection(
  input: ProviderConnectionConfigInput,
): SanitizedProviderConnectionConfig {
  const accepted = validateProviderConnectionConfig(input);
  if (accepted.outcome === "denied") {
    throw new ApiError(
      "invalid_request",
      "Provider connection configuration is invalid.",
      400,
      { code: accepted.code },
    );
  }
  return accepted.config;
}
