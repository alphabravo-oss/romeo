import {
  apiKeys,
  deviceAuthorizations,
  localMfaFactors,
  localPasswordCredentials,
  serviceAccounts,
  userSessions,
} from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type ScopeRecord =
  | "admin:read"
  | "admin:write"
  | "agents:create"
  | "agents:read"
  | "agents:run"
  | "agents:write"
  | "audit:read"
  | "chats:read"
  | "chats:write"
  | "knowledge:query"
  | "knowledge:read"
  | "knowledge:write"
  | "me:read"
  | "models:read"
  | "models:use"
  | "organizations:read"
  | "providers:read"
  | "providers:write"
  | "runs:cancel"
  | "runs:create"
  | "runs:read"
  | "tools:manage"
  | "tools:use"
  | "usage:read"
  | "voices:manage"
  | "voices:use"
  | "webhooks:read"
  | "webhooks:write"
  | "workspaces:read";

export interface ApiKeyRecord {
  id: string;
  orgId: string;
  userId?: string;
  serviceAccountId?: string;
  name: string;
  hashedToken: string;
  scopes: ScopeRecord[];
  revokedAt?: string;
  createdAt: string;
}

export interface ServiceAccountRecord {
  id: string;
  orgId: string;
  name: string;
  scopes: ScopeRecord[];
  createdBy: string;
  disabledAt?: string;
  createdAt: string;
}

export interface UserSessionRecord {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  hashedToken: string;
  scopes: ScopeRecord[];
  isAdmin: boolean;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface LocalPasswordCredentialRecord {
  id: string;
  orgId: string;
  userId: string;
  emailNormalized: string;
  passwordHash: string;
  failedAttemptCount: number;
  lockedUntil?: string;
  passwordUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMfaFactorRecord {
  id: string;
  orgId: string;
  userId: string;
  type: "recovery_codes" | "totp";
  name: string;
  status: "pending" | "active" | "disabled";
  secretEncrypted: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
}

export interface DeviceAuthorizationRecord {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  scopes: ScopeRecord[];
  hashedRefreshToken: string;
  accessApiKeyId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
}

const scopeValues = new Set<ScopeRecord>([
  "admin:read",
  "admin:write",
  "agents:create",
  "agents:read",
  "agents:run",
  "agents:write",
  "audit:read",
  "chats:read",
  "chats:write",
  "knowledge:query",
  "knowledge:read",
  "knowledge:write",
  "me:read",
  "models:read",
  "models:use",
  "organizations:read",
  "providers:read",
  "providers:write",
  "runs:cancel",
  "runs:create",
  "runs:read",
  "tools:manage",
  "tools:use",
  "usage:read",
  "voices:manage",
  "voices:use",
  "webhooks:read",
  "webhooks:write",
  "workspaces:read",
]);

function asScopes(values: string[]): ScopeRecord[] {
  return values.filter((value): value is ScopeRecord =>
    scopeValues.has(value as ScopeRecord),
  );
}

export function toApiKeyRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  const record: ApiKeyRecord = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    hashedToken: row.hashedToken,
    scopes: asScopes(row.scopes),
    createdAt: toIsoString(row.createdAt),
  };
  const userId = optionalIsoString(row.userId);
  if (userId !== undefined) record.userId = userId;
  const serviceAccountId = optionalIsoString(row.serviceAccountId);
  if (serviceAccountId !== undefined)
    record.serviceAccountId = serviceAccountId;
  const revokedAt = optionalIsoString(row.revokedAt);
  if (revokedAt !== undefined) record.revokedAt = revokedAt;
  return record;
}

export function toServiceAccountRecord(
  row: typeof serviceAccounts.$inferSelect,
): ServiceAccountRecord {
  const record: ServiceAccountRecord = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    scopes: asScopes(row.scopes),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
  };
  const disabledAt = optionalIsoString(row.disabledAt);
  if (disabledAt !== undefined) record.disabledAt = disabledAt;
  return record;
}

export function toUserSessionRecord(
  row: typeof userSessions.$inferSelect,
): UserSessionRecord {
  const record: UserSessionRecord = {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    name: row.name,
    hashedToken: row.hashedToken,
    scopes: asScopes(row.scopes),
    isAdmin: row.isAdmin,
    expiresAt: toIsoString(row.expiresAt),
    createdAt: toIsoString(row.createdAt),
  };
  const revokedAt = optionalIsoString(row.revokedAt);
  if (revokedAt !== undefined) record.revokedAt = revokedAt;
  const lastSeenAt = optionalIsoString(row.lastSeenAt);
  if (lastSeenAt !== undefined) record.lastSeenAt = lastSeenAt;
  return record;
}

export function toLocalPasswordCredentialRecord(
  row: typeof localPasswordCredentials.$inferSelect,
): LocalPasswordCredentialRecord {
  const record: LocalPasswordCredentialRecord = {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    emailNormalized: row.emailNormalized,
    passwordHash: row.passwordHash,
    failedAttemptCount: row.failedAttemptCount,
    passwordUpdatedAt: toIsoString(row.passwordUpdatedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const lockedUntil = optionalIsoString(row.lockedUntil);
  if (lockedUntil !== undefined) record.lockedUntil = lockedUntil;
  return record;
}

export function toLocalMfaFactorRecord(
  row: typeof localMfaFactors.$inferSelect,
): LocalMfaFactorRecord {
  const record: LocalMfaFactorRecord = {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    type: row.type === "recovery_codes" ? "recovery_codes" : "totp",
    name: row.name,
    status:
      row.status === "active" || row.status === "disabled"
        ? row.status
        : "pending",
    secretEncrypted: row.secretEncrypted,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const confirmedAt = optionalIsoString(row.confirmedAt);
  if (confirmedAt !== undefined) record.confirmedAt = confirmedAt;
  const disabledAt = optionalIsoString(row.disabledAt);
  if (disabledAt !== undefined) record.disabledAt = disabledAt;
  const lastUsedAt = optionalIsoString(row.lastUsedAt);
  if (lastUsedAt !== undefined) record.lastUsedAt = lastUsedAt;
  return record;
}

export function toDeviceAuthorizationRecord(
  row: typeof deviceAuthorizations.$inferSelect,
): DeviceAuthorizationRecord {
  const record: DeviceAuthorizationRecord = {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    name: row.name,
    scopes: asScopes(row.scopes),
    hashedRefreshToken: row.hashedRefreshToken,
    accessApiKeyId: row.accessApiKeyId,
    expiresAt: toIsoString(row.expiresAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const lastRefreshedAt = optionalIsoString(row.lastRefreshedAt);
  if (lastRefreshedAt !== undefined) record.lastRefreshedAt = lastRefreshedAt;
  const revokedAt = optionalIsoString(row.revokedAt);
  if (revokedAt !== undefined) record.revokedAt = revokedAt;
  return record;
}

export function toApiKeyInsert(
  record: ApiKeyRecord,
): typeof apiKeys.$inferInsert {
  return {
    ...record,
    userId: record.userId ?? null,
    serviceAccountId: record.serviceAccountId ?? null,
    revokedAt: optionalDate(record.revokedAt),
    createdAt: new Date(record.createdAt),
  };
}

export function toServiceAccountInsert(
  record: ServiceAccountRecord,
): typeof serviceAccounts.$inferInsert {
  return {
    ...record,
    disabledAt: optionalDate(record.disabledAt),
    createdAt: new Date(record.createdAt),
  };
}

export function toUserSessionInsert(
  record: UserSessionRecord,
): typeof userSessions.$inferInsert {
  return {
    ...record,
    expiresAt: new Date(record.expiresAt),
    revokedAt: optionalDate(record.revokedAt),
    lastSeenAt: optionalDate(record.lastSeenAt),
    createdAt: new Date(record.createdAt),
  };
}

export function toLocalPasswordCredentialInsert(
  record: LocalPasswordCredentialRecord,
): typeof localPasswordCredentials.$inferInsert {
  return {
    ...record,
    lockedUntil: optionalDate(record.lockedUntil),
    passwordUpdatedAt: new Date(record.passwordUpdatedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toLocalMfaFactorInsert(
  record: LocalMfaFactorRecord,
): typeof localMfaFactors.$inferInsert {
  return {
    ...record,
    confirmedAt: optionalDate(record.confirmedAt),
    disabledAt: optionalDate(record.disabledAt),
    lastUsedAt: optionalDate(record.lastUsedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toDeviceAuthorizationInsert(
  record: DeviceAuthorizationRecord,
): typeof deviceAuthorizations.$inferInsert {
  return {
    ...record,
    expiresAt: new Date(record.expiresAt),
    revokedAt: optionalDate(record.revokedAt),
    lastRefreshedAt: optionalDate(record.lastRefreshedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
