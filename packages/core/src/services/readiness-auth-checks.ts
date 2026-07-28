import type { RomeoEnv } from "@romeo/config";

import type { EffectiveAuthProviderSetting } from "../domain/auth-provider-settings";
import { managedSecretKeyConfigured } from "./managed-secret-service";
import { fail, pass, warn, type ReadinessCheck } from "./readiness-result";

export function localAuthSecretEncryptionKeyCheck(
  env: RomeoEnv,
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const localEnabled =
    providers.find((provider) => provider.providerId === "local")?.enabled ===
    true;
  if (!localEnabled) {
    return pass(
      "local_auth_secret_encryption_key",
      "Local auth is disabled for the effective provider policy.",
      { localAuthEnabled: false },
    );
  }
  if (unsafeSecretValue(env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY)) {
    return fail(
      "local_auth_secret_encryption_key",
      "critical",
      "Local auth MFA secret encryption key must be rotated from the development default.",
      { localAuthEnabled: true, minLength: 32 },
    );
  }
  return pass(
    "local_auth_secret_encryption_key",
    "Local auth MFA secret encryption key is production-shaped.",
    { localAuthEnabled: true, minLength: 32 },
  );
}

export function authProviderFallbackCheck(
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const enabledImplemented = providers.filter(
    (provider) => provider.enabled && provider.catalogStatus === "implemented",
  );
  const localEnabled = enabledImplemented.some(
    (provider) => provider.providerId === "local",
  );
  if (localEnabled) {
    return pass(
      "auth_provider_local_fallback",
      "Local authentication fallback is enabled.",
      { localAuthEnabled: true },
    );
  }
  const enabledProviderIds = enabledImplemented
    .map((provider) => provider.providerId)
    .sort();
  if (enabledProviderIds.length === 0) {
    return fail(
      "auth_provider_local_fallback",
      "critical",
      "No implemented authentication provider is enabled.",
      { required: "local auth or another implemented provider" },
    );
  }
  return warn(
    "auth_provider_local_fallback",
    "Local authentication fallback is disabled for the effective provider policy.",
    {
      enabledProviderCount: enabledProviderIds.length,
      enabledProviderIds,
    },
  );
}

export function authProviderOidcConfigCheck(
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const enabledOidcProviders = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.catalogStatus === "implemented" &&
      provider.protocol === "oidc",
  );
  const incompleteProviderIds = enabledOidcProviders
    .filter(
      (provider) =>
        provider.oidc?.issuerConfigured !== true ||
        provider.oidc?.clientIdConfigured !== true,
    )
    .map((provider) => provider.providerId)
    .sort();
  if (incompleteProviderIds.length > 0) {
    return fail(
      "auth_provider_oidc_config",
      "critical",
      "Enabled OIDC authentication providers have incomplete per-provider connection config.",
      {
        incompleteProviderCount: incompleteProviderIds.length,
        incompleteProviderIds,
        required: "issuer URL and client ID per enabled OIDC provider",
      },
    );
  }
  return pass(
    "auth_provider_oidc_config",
    "Enabled OIDC authentication provider config is complete.",
    { enabledOidcProviderCount: enabledOidcProviders.length },
  );
}

export function authProviderSecretRefCheck(
  env: RomeoEnv,
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const configured = providers.filter(
    (provider) => provider.secretRefConfigured,
  );
  const invalidProviderIds = configured
    .filter(
      (provider) =>
        provider.secretRefScheme === undefined ||
        provider.secretRefScheme === "invalid",
    )
    .map((provider) => provider.providerId)
    .sort();
  if (invalidProviderIds.length > 0) {
    return fail(
      "auth_provider_secret_refs",
      "critical",
      "Authentication provider secret references include invalid managed-secret schemes.",
      {
        invalidProviderCount: invalidProviderIds.length,
        invalidProviderIds,
      },
    );
  }
  const schemes = [
    ...new Set(configured.map((provider) => provider.secretRefScheme)),
  ]
    .filter((scheme): scheme is string => typeof scheme === "string")
    .sort();
  const externalConfigured = configured.filter(
    (provider) => provider.secretRefScheme !== "romeo-secret",
  );
  if (
    externalConfigured.length > 0 &&
    env.SECRET_RESOLVER_DRIVER === "disabled"
  ) {
    return warn(
      "auth_provider_secret_refs",
      "Authentication provider secret refs are configured while runtime secret resolution is disabled.",
      {
        configuredProviderCount: configured.length,
        externalConfiguredProviderCount: externalConfigured.length,
        secretRefSchemes: schemes,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
      },
    );
  }
  return pass(
    "auth_provider_secret_refs",
    "Authentication provider secret-ref posture is explicit.",
    {
      configuredProviderCount: configured.length,
      secretRefSchemes: schemes,
      secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    },
  );
}

export function managedSecretEncryptionKeyCheck(
  env: RomeoEnv,
  providers: EffectiveAuthProviderSetting[],
): ReadinessCheck {
  const configuredProviderIds = providers
    .filter((provider) => provider.secretRefScheme === "romeo-secret")
    .map((provider) => provider.providerId)
    .sort();
  if (configuredProviderIds.length === 0) {
    return pass(
      "managed_secret_encryption_key",
      "No locally managed encrypted auth-provider secrets are configured.",
      { managedSecretConfigured: false },
    );
  }
  if (!managedSecretKeyConfigured(env)) {
    return fail(
      "managed_secret_encryption_key",
      "critical",
      "Managed secret encryption key must be rotated from the development default.",
      {
        configuredProviderCount: configuredProviderIds.length,
        configuredProviderIds,
        minLength: 32,
      },
    );
  }
  return pass(
    "managed_secret_encryption_key",
    "Managed secret encryption key is production-shaped.",
    {
      configuredProviderCount: configuredProviderIds.length,
      configuredProviderIds,
      minLength: 32,
    },
  );
}

export function secretCheck(
  id: string,
  value: string,
  message: string,
): ReadinessCheck {
  if (unsafeSecretValue(value)) {
    return fail(id, "critical", message, { minLength: 32 });
  }
  return pass(id, message, { minLength: 32 });
}

function unsafeSecretValue(value: string): boolean {
  return (
    value.startsWith("dev-") || value.includes("change-me") || value.length < 32
  );
}

export function previousSecretCheck(
  id: string,
  value: string,
  currentValue: string,
  message: string,
): ReadinessCheck {
  if (value.length === 0) {
    return pass(id, "No previous session secret is staged.", {
      configured: false,
      mode: "not_staged",
    });
  }
  if (value === currentValue) {
    return fail(
      id,
      "critical",
      "Previous session secret must differ from the current secret.",
      {
        configured: true,
        required: "distinct previous secret",
      },
    );
  }
  if (
    value.startsWith("dev-") ||
    value.includes("change-me") ||
    value.length < 32
  ) {
    return fail(
      id,
      "critical",
      "Previous session secret is not production-safe.",
      {
        configured: true,
        minLength: 32,
      },
    );
  }
  return pass(id, message, {
    configured: true,
    mode: "dual_read_oidc_pkce_only",
    minLength: 32,
  });
}

export function oidcCheck(env: RomeoEnv): ReadinessCheck {
  const issuerConfigured = env.OIDC_ISSUER_URL.length > 0;
  const clientConfigured = env.OIDC_CLIENT_ID.length > 0;
  if (issuerConfigured !== clientConfigured) {
    return warn("oidc_config", "OIDC is partially configured.", {
      required: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID"],
    });
  }
  return pass(
    "oidc_config",
    issuerConfigured
      ? "OIDC issuer and client ID are configured."
      : "OIDC is not configured.",
    {
      configured: issuerConfigured,
      groupClaim: env.OIDC_GROUP_CLAIM,
      adminGroupMapping: env.OIDC_ADMIN_GROUPS.length > 0,
    },
  );
}
