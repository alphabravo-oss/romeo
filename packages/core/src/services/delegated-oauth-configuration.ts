import { createHmac, timingSafeEqual } from "node:crypto";
import type { RomeoEnv } from "@romeo/config";

import type { DataConnectorType } from "../domain/data-connectors";
import type {
  DelegatedOAuthProvider,
  DelegatedOAuthProviderId,
} from "../domain/delegated-oauth";
import { ApiError } from "../errors";
import type {
  DelegatedOAuthProviderDefinition,
  DelegatedOAuthState,
} from "./delegated-oauth-internal-types";
import {
  base64Url,
  csv,
  isDelegatedOAuthState,
  parseJsonState,
} from "./delegated-oauth-support";
import { DelegatedOAuthTokenVault } from "./delegated-oauth-token-vault";

export const providerDefinitions: DelegatedOAuthProviderDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    connectorTypes: ["github"],
  },
];

export class DelegatedOAuthConfiguration {
  constructor(private readonly env: RomeoEnv) {}

  get tokenEncryptionKey(): string {
    return this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY;
  }

  providerDefinition(
    providerId: DelegatedOAuthProviderId,
  ): DelegatedOAuthProviderDefinition {
    const definition = providerDefinitions.find(
      (item) => item.id === providerId,
    );
    if (definition === undefined) {
      throw new ApiError(
        "delegated_oauth_provider_unknown",
        "Delegated OAuth provider is not supported.",
        404,
      );
    }
    return definition;
  }

  toPublicProvider(
    definition: DelegatedOAuthProviderDefinition,
  ): DelegatedOAuthProvider {
    return {
      authorizationHost: new URL(definition.authorizationUrl).host,
      configured: this.isProviderReady(definition.id),
      connectorTypes: definition.connectorTypes,
      defaultScopes: this.normalizeScopes(),
      displayName: definition.displayName,
      id: definition.id,
      pkceRequired: true,
      tokenHost: new URL(definition.tokenUrl).host,
    };
  }

  assertProviderReady(
    providerId: DelegatedOAuthProviderId,
    clientId = this.clientId(providerId),
  ): void {
    if (clientId.length === 0) {
      throw new ApiError(
        "delegated_oauth_provider_not_configured",
        "Delegated OAuth provider is not configured.",
        409,
      );
    }
    if (this.clientSecret(providerId).length === 0) {
      throw new ApiError(
        "delegated_oauth_client_secret_not_configured",
        "Delegated OAuth client secret is not configured.",
        409,
      );
    }
    new DelegatedOAuthTokenVault(this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY);
  }

  isProviderReady(providerId: DelegatedOAuthProviderId): boolean {
    return (
      this.clientId(providerId).length > 0 &&
      this.clientSecret(providerId).length > 0 &&
      this.env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY.trim().length >= 32
    );
  }

  clientId(providerId: DelegatedOAuthProviderId): string {
    switch (providerId) {
      case "github":
        return this.env.DELEGATED_OAUTH_GITHUB_CLIENT_ID;
    }
  }

  clientSecret(providerId: DelegatedOAuthProviderId): string {
    switch (providerId) {
      case "github":
        return this.env.DELEGATED_OAUTH_GITHUB_CLIENT_SECRET;
    }
  }

  normalizeScopes(input?: string[]): string[] {
    const allowed = csv(this.env.DELEGATED_OAUTH_GITHUB_SCOPES);
    const requested =
      input === undefined || input.length === 0 ? allowed : input;
    const scopes: string[] = [];
    for (const raw of requested) {
      const scope = raw.trim();
      if (!/^[A-Za-z0-9:_./-]{1,120}$/u.test(scope)) {
        throw new ApiError(
          "delegated_oauth_scope_invalid",
          "Delegated OAuth scopes must use safe scope names.",
          400,
        );
      }
      if (!allowed.includes(scope)) {
        throw new ApiError(
          "delegated_oauth_scope_not_allowed",
          "Delegated OAuth scope is not allowed for this provider.",
          400,
        );
      }
      if (!scopes.includes(scope)) scopes.push(scope);
      if (scopes.length > 20) {
        throw new ApiError(
          "delegated_oauth_scope_limit",
          "Delegated OAuth scope count exceeds the limit.",
          400,
        );
      }
    }
    if (scopes.length === 0) {
      throw new ApiError(
        "delegated_oauth_scope_required",
        "Delegated OAuth requires at least one scope.",
        400,
      );
    }
    return scopes;
  }

  signState(state: DelegatedOAuthState): string {
    const payload = base64Url(JSON.stringify(state));
    const signature = this.signPayload(payload);
    return `${payload}.${signature}`;
  }

  verifyState(value: string | undefined): DelegatedOAuthState {
    if (value === undefined || value.length === 0) {
      throw new ApiError(
        "delegated_oauth_state_missing",
        "Delegated OAuth state cookie is missing.",
        400,
      );
    }
    const [payload, signature, extra] = value.split(".");
    if (
      payload === undefined ||
      signature === undefined ||
      extra !== undefined ||
      !this.matchesSignature(payload, signature)
    ) {
      throw new ApiError(
        "delegated_oauth_state_invalid",
        "Delegated OAuth state is invalid.",
        400,
      );
    }
    const decoded = parseJsonState(payload);
    if (!isDelegatedOAuthState(decoded)) {
      throw new ApiError(
        "delegated_oauth_state_invalid",
        "Delegated OAuth state is invalid.",
        400,
      );
    }
    return decoded;
  }

  signPayload(payload: string): string {
    return createHmac("sha256", this.env.SESSION_SECRET)
      .update(payload)
      .digest("base64url");
  }

  matchesSignature(payload: string, signature: string): boolean {
    return (
      this.matchesSignatureWithSecret(
        payload,
        signature,
        this.env.SESSION_SECRET,
      ) ||
      (this.env.SESSION_SECRET_PREVIOUS.length > 0 &&
        this.matchesSignatureWithSecret(
          payload,
          signature,
          this.env.SESSION_SECRET_PREVIOUS,
        ))
    );
  }

  matchesSignatureWithSecret(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    const expected = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
