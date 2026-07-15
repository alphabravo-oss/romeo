import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import { createHash } from "node:crypto";

import type { SsoOidcSettings, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  authProviderCatalog,
  type AuthProviderCatalogEntry,
} from "../domain/auth-providers";
import {
  detectSsoOidcProviderPreset,
  isSsoOidcProviderPresetId,
  providerPresetById,
  ssoOidcProviderPresets,
  type SsoOidcProviderPresetId,
  type SsoOidcProviderPresetSummary,
} from "../domain/sso-provider-presets";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import { oidcUserId } from "./oidc-client";
import {
  testOidcConnection,
  type OidcConnectionTestCheck,
} from "./oidc-connection-test";
import {
  assertTrustedMetadataUrl,
  mappingCount,
  normalizeIssuer,
  oidcConfigStatus,
  resolveSsoOidcConfig,
  safeHost,
  type ResolvedSsoOidcConfig,
  type SsoConfigurationSource,
} from "./sso-config";
import { UserLifecycleService } from "./user-lifecycle-service";

export interface SsoSettingsReport {
  generatedAt: string;
  configurationSource: SsoConfigurationSource;
  status: "disabled" | "enabled" | "partial";
  localLogin: {
    seededDevelopmentLoginEnabled: boolean;
  };
  oidc: {
    detectedProviderPreset: SsoOidcProviderPresetId;
    providerPresets: SsoOidcProviderPresetSummary[];
    bearerTokenAuthEnabled: boolean;
    browserPkceLoginEnabled: boolean;
    issuerConfigured: boolean;
    issuerHost?: string;
    clientIdConfigured: boolean;
    groupClaim: string;
    adminGroupCount: number;
    groupMappingCount: number;
    workspaceGroupMappingCount: number;
    workspaceGroupPrefixConfigured: boolean;
    jitProvisioningEnabled: boolean;
    accountLinkingEnabled: false;
  };
  notes: string[];
}

export interface SsoConnectionTestReport {
  generatedAt: string;
  status: "disabled" | "failed" | "partial" | "passed";
  issuerHost?: string;
  checks: OidcConnectionTestCheck[];
  notes: string[];
}

export interface UpdateSsoSettingsInput {
  subject: AuthSubject;
  oidc: {
    enabled?: boolean | undefined;
    issuerUrl?: string | undefined;
    clientId?: string | undefined;
    groupClaim?: string | undefined;
    adminGroups?: string[] | undefined;
    groupMap?: Record<string, string> | undefined;
    workspaceGroupMap?: Record<string, string> | undefined;
    workspaceGroupPrefix?: string | undefined;
    providerPreset?: SsoOidcProviderPresetId | undefined;
  };
}

export interface DeprovisionSsoOidcUserInput {
  subject: AuthSubject;
  oidcSubject: string;
  confirmOidcSubject: string;
  issuerUrl?: string | undefined;
}

export interface SsoOidcDeprovisionResult {
  status: "already_disabled" | "disabled";
  issuerHost?: string;
  user: User;
}

export class SsoSettingsService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly users?: UserLifecycleService,
  ) {}

  async report(subject: AuthSubject): Promise<SsoSettingsReport> {
    assertScope(subject, "admin:read");
    const config = await resolveSsoOidcConfig(
      this.repository,
      this.env,
      subject.orgId,
    );
    return this.toReport(config);
  }

  authProviderCatalog(subject: AuthSubject): AuthProviderCatalogEntry[] {
    assertScope(subject, "admin:read");
    return authProviderCatalog;
  }

  async update(input: UpdateSsoSettingsInput): Promise<SsoSettingsReport> {
    assertScope(input.subject, "admin:write");
    const existing = await this.repository.getSsoOidcSettings(
      input.subject.orgId,
    );
    const base = await resolveSsoOidcConfig(
      this.repository,
      this.env,
      input.subject.orgId,
    );
    const now = new Date().toISOString();
    const settings = normalizeSettingsUpdate(
      input.subject,
      input.oidc,
      base,
      existing,
      now,
    );
    const updated = await this.repository.transaction(async (repository) => {
      const updatedSettings = await repository.upsertSsoOidcSettings(settings);
      await this.audit(repository, input.subject, "admin.sso_settings.update", {
        resourceId: input.subject.orgId,
        resourceType: "sso_settings",
        metadata: sanitizedSettingsMetadata(updatedSettings),
      });
      return updatedSettings;
    });
    return this.toReport({ ...updated, source: "database" });
  }

  private toReport(config: ResolvedSsoOidcConfig): SsoSettingsReport {
    const status = oidcConfigStatus(config);
    const issuerHost = safeHost(config.issuerUrl);
    return {
      generatedAt: new Date().toISOString(),
      configurationSource: config.source,
      status: status.status,
      localLogin: {
        seededDevelopmentLoginEnabled: this.env.DEV_SEEDED_LOGIN,
      },
      oidc: {
        detectedProviderPreset: detectSsoOidcProviderPreset(config.issuerUrl),
        providerPresets: ssoOidcProviderPresets,
        bearerTokenAuthEnabled: status.bearerTokenAuthEnabled,
        browserPkceLoginEnabled: status.bearerTokenAuthEnabled,
        issuerConfigured: status.issuerConfigured,
        ...(issuerHost === undefined ? {} : { issuerHost }),
        clientIdConfigured: status.clientIdConfigured,
        groupClaim: config.groupClaim,
        adminGroupCount: config.adminGroups.length,
        groupMappingCount: mappingCount(config.groupMap),
        workspaceGroupMappingCount: mappingCount(config.workspaceGroupMap),
        workspaceGroupPrefixConfigured: config.workspaceGroupPrefix.length > 0,
        jitProvisioningEnabled: status.bearerTokenAuthEnabled,
        accountLinkingEnabled: false,
      },
      notes: ssoNotes(status.status, config.source),
    };
  }

  async connectionTest(subject: AuthSubject): Promise<SsoConnectionTestReport> {
    assertScope(subject, "admin:read");
    const config = await resolveSsoOidcConfig(
      this.repository,
      this.env,
      subject.orgId,
    );
    return testOidcConnection({ config, fetchImpl: this.fetchImpl });
  }

  async deprovisionOidcUser(
    input: DeprovisionSsoOidcUserInput,
  ): Promise<SsoOidcDeprovisionResult> {
    assertScope(input.subject, "admin:write");
    if (this.users === undefined)
      throw new ApiError(
        "sso_oidc_deprovision_unavailable",
        "OIDC deprovisioning is not available.",
        503,
      );
    const oidcSubject = normalizeOidcSubject(input.oidcSubject);
    const confirmOidcSubject = normalizeOidcSubject(input.confirmOidcSubject);
    if (oidcSubject !== confirmOidcSubject) {
      throw new ApiError(
        "sso_oidc_subject_confirmation_mismatch",
        "OIDC subject confirmation must match the OIDC subject.",
        400,
      );
    }
    const config = await resolveSsoOidcConfig(
      this.repository,
      this.env,
      input.subject.orgId,
    );
    const status = oidcConfigStatus(config);
    if (!status.bearerTokenAuthEnabled) {
      throw new ApiError(
        "sso_oidc_not_configured",
        "OIDC must be enabled with an issuer URL and client ID before deprovisioning OIDC users.",
        400,
      );
    }
    const issuer = normalizeInputIssuer(config.issuerUrl);
    const requestedIssuer =
      input.issuerUrl === undefined
        ? issuer
        : normalizeInputIssuer(input.issuerUrl);
    if (requestedIssuer !== issuer)
      throw new ApiError(
        "sso_oidc_issuer_mismatch",
        "Requested issuer does not match the active OIDC issuer.",
        400,
      );
    const userId = oidcUserId(issuer, oidcSubject);
    const existing = await this.repository.getCurrentUser(userId);
    if (existing === undefined || existing.orgId !== input.subject.orgId)
      throw notFound("User");
    const wasDisabled = existing.disabledAt !== undefined;
    const deprovisionStatus = wasDisabled ? "already_disabled" : "disabled";
    const issuerHost = safeHost(issuer);
    const user = await this.repository.transaction(async (repository) => {
      const userLifecycle = this.userLifecycleService(repository);
      const disabled = await userLifecycle.disable({
        subject: input.subject,
        userId,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.sso_oidc.deprovision",
        resourceType: "user",
        resourceId: disabled.id,
        metadata: {
          credentialRevocation: "user_api_keys_and_sessions",
          issuerHost,
          status: deprovisionStatus,
          subjectHash: hashOidcSubject(issuer, oidcSubject),
          subjectLength: oidcSubject.length,
        },
      });
      return disabled;
    });
    return {
      status: deprovisionStatus,
      ...(issuerHost === undefined ? {} : { issuerHost }),
      user,
    };
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    input: {
      metadata: Record<string, unknown>;
      resourceId: string;
      resourceType: string;
    },
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
    });
  }

  private userLifecycleService(
    repository: RomeoRepository,
  ): UserLifecycleService {
    if (repository === this.repository && this.users !== undefined)
      return this.users;
    return new UserLifecycleService(repository);
  }
}

function normalizeSettingsUpdate(
  subject: AuthSubject,
  patch: UpdateSsoSettingsInput["oidc"],
  base: ResolvedSsoOidcConfig,
  existing: SsoOidcSettings | undefined,
  now: string,
): SsoOidcSettings {
  const providerPreset =
    patch.providerPreset === undefined
      ? undefined
      : normalizeProviderPreset(patch.providerPreset);
  const issuerUrl =
    patch.issuerUrl === undefined
      ? base.issuerUrl
      : normalizeInputIssuer(patch.issuerUrl);
  const clientId =
    patch.clientId === undefined ? base.clientId : patch.clientId.trim();
  const enabled = patch.enabled ?? base.enabled;
  if (enabled && (issuerUrl.length === 0 || clientId.length === 0)) {
    throw new ApiError(
      "invalid_sso_settings",
      "Enabled OIDC settings require an issuer URL and client ID.",
      400,
    );
  }
  return {
    orgId: subject.orgId,
    enabled,
    issuerUrl,
    clientId,
    groupClaim: normalizeNonEmptyString(
      patch.groupClaim ??
        (providerPreset === undefined
          ? base.groupClaim
          : providerPresetById(providerPreset).recommendedGroupClaim),
      "group claim",
    ),
    adminGroups: normalizeStringList(patch.adminGroups ?? base.adminGroups),
    groupMap: normalizeStringMap(patch.groupMap ?? base.groupMap),
    workspaceGroupMap: normalizeStringMap(
      patch.workspaceGroupMap ?? base.workspaceGroupMap,
    ),
    workspaceGroupPrefix: (
      patch.workspaceGroupPrefix ?? base.workspaceGroupPrefix
    ).trim(),
    createdBy: existing?.createdBy ?? subject.id,
    updatedBy: subject.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function normalizeInputIssuer(value: string): string {
  const issuer = normalizeIssuer(value.trim());
  if (issuer.length === 0) return "";
  try {
    assertTrustedMetadataUrl(issuer);
    return issuer;
  } catch {
    throw new ApiError(
      "invalid_sso_oidc_issuer",
      "OIDC issuer URL must use HTTPS outside localhost.",
      400,
    );
  }
}

function normalizeProviderPreset(value: string): SsoOidcProviderPresetId {
  if (isSsoOidcProviderPresetId(value)) return value;
  throw new ApiError(
    "invalid_sso_provider_preset",
    "OIDC provider preset is not supported.",
    400,
  );
}

function normalizeOidcSubject(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200)
    throw new ApiError(
      "invalid_sso_oidc_subject",
      "OIDC subject must be between 1 and 200 characters.",
      400,
    );
  return normalized;
}

function hashOidcSubject(issuer: string, subject: string): string {
  return createHash("sha256").update(`${issuer}\0${subject}`).digest("hex");
}

function normalizeNonEmptyString(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0)
    throw new ApiError(
      "invalid_sso_settings",
      `OIDC ${label} cannot be empty.`,
      400,
    );
  return normalized;
}

function normalizeStringList(values: string[]): string[] {
  return [
    ...new Set(
      values.map((item) => item.trim()).filter((item) => item.length > 0),
    ),
  ].sort();
}

function normalizeStringMap(
  value: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([key, item]) => key.length > 0 && item.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function sanitizedSettingsMetadata(
  settings: SsoOidcSettings,
): Record<string, unknown> {
  return {
    configurationSource: "database",
    enabled: settings.enabled,
    issuerHost: safeHost(settings.issuerUrl),
    clientIdConfigured: settings.clientId.length > 0,
    groupClaim: settings.groupClaim,
    adminGroupCount: settings.adminGroups.length,
    groupMappingCount: mappingCount(settings.groupMap),
    workspaceGroupMappingCount: mappingCount(settings.workspaceGroupMap),
    workspaceGroupPrefixConfigured: settings.workspaceGroupPrefix.length > 0,
    providerPreset: detectSsoOidcProviderPreset(settings.issuerUrl),
  };
}

function ssoNotes(
  status: SsoSettingsReport["status"],
  source: SsoConfigurationSource,
): string[] {
  const sourceNote =
    source === "database"
      ? "SSO settings are managed from the admin configuration record."
      : "SSO settings are read from environment configuration.";
  if (status === "enabled") {
    return [
      sourceNote,
      "OIDC bearer-token authentication and browser PKCE login are enabled.",
      "Account linking is not enabled in this build.",
    ];
  }
  if (status === "partial") {
    return [
      sourceNote,
      "OIDC configuration is incomplete; set both issuer URL and client ID before relying on SSO.",
    ];
  }
  return [sourceNote, "OIDC is not configured."];
}
