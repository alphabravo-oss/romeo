import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
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

export class PgAuthCredentialRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listApiKeys(orgId: string): Promise<ApiKeyRecord[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.orgId, orgId))
      .orderBy(desc(apiKeys.createdAt), asc(apiKeys.id));
    return rows.map(toApiKeyRecord);
  }

  async getApiKey(apiKeyId: string): Promise<ApiKeyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId))
      .limit(1);
    return row === undefined ? undefined : toApiKeyRecord(row);
  }

  async getApiKeyByHash(
    hashedToken: string,
  ): Promise<ApiKeyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.hashedToken, hashedToken))
      .limit(1);
    return row === undefined ? undefined : toApiKeyRecord(row);
  }

  async createApiKey(apiKey: ApiKeyRecord): Promise<ApiKeyRecord> {
    const [row] = await this.db
      .insert(apiKeys)
      .values(toApiKeyInsert(apiKey))
      .returning();
    return row === undefined ? apiKey : toApiKeyRecord(row);
  }

  async updateApiKey(apiKey: ApiKeyRecord): Promise<ApiKeyRecord> {
    const [row] = await this.db
      .update(apiKeys)
      .set({
        name: apiKey.name,
        revokedAt: optionalDate(apiKey.revokedAt),
        scopes: apiKey.scopes,
      })
      .where(eq(apiKeys.id, apiKey.id))
      .returning();
    return row === undefined ? apiKey : toApiKeyRecord(row);
  }

  async listDeviceAuthorizations(
    orgId: string,
    userId: string,
  ): Promise<DeviceAuthorizationRecord[]> {
    const rows = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(
        and(
          eq(deviceAuthorizations.orgId, orgId),
          eq(deviceAuthorizations.userId, userId),
        ),
      )
      .orderBy(
        desc(deviceAuthorizations.updatedAt),
        asc(deviceAuthorizations.id),
      );
    return rows.map(toDeviceAuthorizationRecord);
  }

  async getDeviceAuthorization(
    deviceAuthorizationId: string,
  ): Promise<DeviceAuthorizationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.id, deviceAuthorizationId))
      .limit(1);
    return row === undefined ? undefined : toDeviceAuthorizationRecord(row);
  }

  async getDeviceAuthorizationByRefreshHash(
    hashedRefreshToken: string,
  ): Promise<DeviceAuthorizationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.hashedRefreshToken, hashedRefreshToken))
      .limit(1);
    return row === undefined ? undefined : toDeviceAuthorizationRecord(row);
  }

  async createDeviceAuthorization(
    authorization: DeviceAuthorizationRecord,
  ): Promise<DeviceAuthorizationRecord> {
    const [row] = await this.db
      .insert(deviceAuthorizations)
      .values(toDeviceAuthorizationInsert(authorization))
      .returning();
    return row === undefined ? authorization : toDeviceAuthorizationRecord(row);
  }

  async updateDeviceAuthorization(
    authorization: DeviceAuthorizationRecord,
  ): Promise<DeviceAuthorizationRecord> {
    const [row] = await this.db
      .update(deviceAuthorizations)
      .set({
        accessApiKeyId: authorization.accessApiKeyId,
        expiresAt: new Date(authorization.expiresAt),
        hashedRefreshToken: authorization.hashedRefreshToken,
        lastRefreshedAt: optionalDate(authorization.lastRefreshedAt),
        name: authorization.name,
        revokedAt: optionalDate(authorization.revokedAt),
        scopes: authorization.scopes,
        updatedAt: new Date(authorization.updatedAt),
      })
      .where(eq(deviceAuthorizations.id, authorization.id))
      .returning();
    return row === undefined ? authorization : toDeviceAuthorizationRecord(row);
  }

  async listUserSessions(
    orgId: string,
    userId: string,
  ): Promise<UserSessionRecord[]> {
    const rows = await this.db
      .select()
      .from(userSessions)
      .where(
        and(eq(userSessions.orgId, orgId), eq(userSessions.userId, userId)),
      )
      .orderBy(desc(userSessions.createdAt), asc(userSessions.id));
    return rows.map(toUserSessionRecord);
  }

  async getUserSession(
    sessionId: string,
  ): Promise<UserSessionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);
    return row === undefined ? undefined : toUserSessionRecord(row);
  }

  async getUserSessionByHash(
    hashedToken: string,
  ): Promise<UserSessionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.hashedToken, hashedToken))
      .limit(1);
    return row === undefined ? undefined : toUserSessionRecord(row);
  }

  async createUserSession(
    session: UserSessionRecord,
  ): Promise<UserSessionRecord> {
    const [row] = await this.db
      .insert(userSessions)
      .values(toUserSessionInsert(session))
      .returning();
    return row === undefined ? session : toUserSessionRecord(row);
  }

  async updateUserSession(
    session: UserSessionRecord,
  ): Promise<UserSessionRecord> {
    const [row] = await this.db
      .update(userSessions)
      .set({
        expiresAt: new Date(session.expiresAt),
        isAdmin: session.isAdmin,
        lastSeenAt: optionalDate(session.lastSeenAt),
        name: session.name,
        revokedAt: optionalDate(session.revokedAt),
        scopes: session.scopes,
      })
      .where(eq(userSessions.id, session.id))
      .returning();
    return row === undefined ? session : toUserSessionRecord(row);
  }

  async getLocalPasswordCredentialByUserId(
    userId: string,
  ): Promise<LocalPasswordCredentialRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(localPasswordCredentials)
      .where(eq(localPasswordCredentials.userId, userId))
      .limit(1);
    return row === undefined ? undefined : toLocalPasswordCredentialRecord(row);
  }

  async getLocalPasswordCredentialByEmail(
    orgId: string,
    emailNormalized: string,
  ): Promise<LocalPasswordCredentialRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(localPasswordCredentials)
      .where(
        and(
          eq(localPasswordCredentials.orgId, orgId),
          eq(localPasswordCredentials.emailNormalized, emailNormalized),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toLocalPasswordCredentialRecord(row);
  }

  async createLocalPasswordCredential(
    credential: LocalPasswordCredentialRecord,
  ): Promise<LocalPasswordCredentialRecord> {
    const [row] = await this.db
      .insert(localPasswordCredentials)
      .values(toLocalPasswordCredentialInsert(credential))
      .returning();
    return row === undefined
      ? credential
      : toLocalPasswordCredentialRecord(row);
  }

  async updateLocalPasswordCredential(
    credential: LocalPasswordCredentialRecord,
  ): Promise<LocalPasswordCredentialRecord> {
    const [row] = await this.db
      .update(localPasswordCredentials)
      .set({
        emailNormalized: credential.emailNormalized,
        failedAttemptCount: credential.failedAttemptCount,
        lockedUntil: optionalDate(credential.lockedUntil),
        passwordHash: credential.passwordHash,
        passwordUpdatedAt: new Date(credential.passwordUpdatedAt),
        updatedAt: new Date(credential.updatedAt),
      })
      .where(eq(localPasswordCredentials.id, credential.id))
      .returning();
    return row === undefined
      ? credential
      : toLocalPasswordCredentialRecord(row);
  }

  async listLocalMfaFactors(
    orgId: string,
    userId: string,
  ): Promise<LocalMfaFactorRecord[]> {
    const rows = await this.db
      .select()
      .from(localMfaFactors)
      .where(
        and(
          eq(localMfaFactors.orgId, orgId),
          eq(localMfaFactors.userId, userId),
        ),
      )
      .orderBy(desc(localMfaFactors.updatedAt), asc(localMfaFactors.id));
    return rows.map(toLocalMfaFactorRecord);
  }

  async listLocalMfaFactorsForOrg(
    orgId: string,
  ): Promise<LocalMfaFactorRecord[]> {
    const rows = await this.db
      .select()
      .from(localMfaFactors)
      .where(eq(localMfaFactors.orgId, orgId))
      .orderBy(desc(localMfaFactors.updatedAt), asc(localMfaFactors.id));
    return rows.map(toLocalMfaFactorRecord);
  }

  async getLocalMfaFactor(
    factorId: string,
  ): Promise<LocalMfaFactorRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(localMfaFactors)
      .where(eq(localMfaFactors.id, factorId))
      .limit(1);
    return row === undefined ? undefined : toLocalMfaFactorRecord(row);
  }

  async createLocalMfaFactor(
    factor: LocalMfaFactorRecord,
  ): Promise<LocalMfaFactorRecord> {
    const [row] = await this.db
      .insert(localMfaFactors)
      .values(toLocalMfaFactorInsert(factor))
      .returning();
    return row === undefined ? factor : toLocalMfaFactorRecord(row);
  }

  async updateLocalMfaFactor(
    factor: LocalMfaFactorRecord,
  ): Promise<LocalMfaFactorRecord> {
    const [row] = await this.db
      .update(localMfaFactors)
      .set({
        confirmedAt: optionalDate(factor.confirmedAt),
        disabledAt: optionalDate(factor.disabledAt),
        lastUsedAt: optionalDate(factor.lastUsedAt),
        name: factor.name,
        secretEncrypted: factor.secretEncrypted,
        status: factor.status,
        updatedAt: new Date(factor.updatedAt),
      })
      .where(eq(localMfaFactors.id, factor.id))
      .returning();
    return row === undefined ? factor : toLocalMfaFactorRecord(row);
  }

  async listServiceAccounts(orgId: string): Promise<ServiceAccountRecord[]> {
    const rows = await this.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.orgId, orgId))
      .orderBy(desc(serviceAccounts.createdAt), asc(serviceAccounts.id));
    return rows.map(toServiceAccountRecord);
  }

  async getServiceAccount(
    serviceAccountId: string,
  ): Promise<ServiceAccountRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, serviceAccountId))
      .limit(1);
    return row === undefined ? undefined : toServiceAccountRecord(row);
  }

  async createServiceAccount(
    serviceAccount: ServiceAccountRecord,
  ): Promise<ServiceAccountRecord> {
    const [row] = await this.db
      .insert(serviceAccounts)
      .values(toServiceAccountInsert(serviceAccount))
      .returning();
    return row === undefined ? serviceAccount : toServiceAccountRecord(row);
  }

  async updateServiceAccount(
    serviceAccount: ServiceAccountRecord,
  ): Promise<ServiceAccountRecord> {
    const [row] = await this.db
      .update(serviceAccounts)
      .set({
        disabledAt: optionalDate(serviceAccount.disabledAt),
        name: serviceAccount.name,
        scopes: serviceAccount.scopes,
      })
      .where(eq(serviceAccounts.id, serviceAccount.id))
      .returning();
    return row === undefined ? serviceAccount : toServiceAccountRecord(row);
  }
}

export function toApiKeyRecord(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  const apiKey: ApiKeyRecord = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    hashedToken: row.hashedToken,
    scopes: asScopes(row.scopes),
    createdAt: toIsoString(row.createdAt),
  };
  const userId = optionalIsoString(row.userId);
  if (userId !== undefined) apiKey.userId = userId;
  const serviceAccountId = optionalIsoString(row.serviceAccountId);
  if (serviceAccountId !== undefined)
    apiKey.serviceAccountId = serviceAccountId;
  const revokedAt = optionalIsoString(row.revokedAt);
  if (revokedAt !== undefined) apiKey.revokedAt = revokedAt;
  return apiKey;
}

export function toServiceAccountRecord(
  row: typeof serviceAccounts.$inferSelect,
): ServiceAccountRecord {
  const serviceAccount: ServiceAccountRecord = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    scopes: asScopes(row.scopes),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
  };
  const disabledAt = optionalIsoString(row.disabledAt);
  if (disabledAt !== undefined) serviceAccount.disabledAt = disabledAt;
  return serviceAccount;
}

export function toUserSessionRecord(
  row: typeof userSessions.$inferSelect,
): UserSessionRecord {
  const session: UserSessionRecord = {
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
  if (revokedAt !== undefined) session.revokedAt = revokedAt;
  const lastSeenAt = optionalIsoString(row.lastSeenAt);
  if (lastSeenAt !== undefined) session.lastSeenAt = lastSeenAt;
  return session;
}

export function toLocalPasswordCredentialRecord(
  row: typeof localPasswordCredentials.$inferSelect,
): LocalPasswordCredentialRecord {
  const credential: LocalPasswordCredentialRecord = {
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
  if (lockedUntil !== undefined) credential.lockedUntil = lockedUntil;
  return credential;
}

export function toLocalMfaFactorRecord(
  row: typeof localMfaFactors.$inferSelect,
): LocalMfaFactorRecord {
  const factor: LocalMfaFactorRecord = {
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
  if (confirmedAt !== undefined) factor.confirmedAt = confirmedAt;
  const disabledAt = optionalIsoString(row.disabledAt);
  if (disabledAt !== undefined) factor.disabledAt = disabledAt;
  const lastUsedAt = optionalIsoString(row.lastUsedAt);
  if (lastUsedAt !== undefined) factor.lastUsedAt = lastUsedAt;
  return factor;
}

export function toDeviceAuthorizationRecord(
  row: typeof deviceAuthorizations.$inferSelect,
): DeviceAuthorizationRecord {
  const authorization: DeviceAuthorizationRecord = {
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
  if (lastRefreshedAt !== undefined)
    authorization.lastRefreshedAt = lastRefreshedAt;
  const revokedAt = optionalIsoString(row.revokedAt);
  if (revokedAt !== undefined) authorization.revokedAt = revokedAt;
  return authorization;
}

function toApiKeyInsert(record: ApiKeyRecord): typeof apiKeys.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId ?? null,
    serviceAccountId: record.serviceAccountId ?? null,
    name: record.name,
    hashedToken: record.hashedToken,
    scopes: record.scopes,
    revokedAt: optionalDate(record.revokedAt),
    createdAt: new Date(record.createdAt),
  };
}

function toServiceAccountInsert(
  record: ServiceAccountRecord,
): typeof serviceAccounts.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    name: record.name,
    scopes: record.scopes,
    createdBy: record.createdBy,
    disabledAt: optionalDate(record.disabledAt),
    createdAt: new Date(record.createdAt),
  };
}

function toUserSessionInsert(
  record: UserSessionRecord,
): typeof userSessions.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    name: record.name,
    hashedToken: record.hashedToken,
    scopes: record.scopes,
    isAdmin: record.isAdmin,
    expiresAt: new Date(record.expiresAt),
    revokedAt: optionalDate(record.revokedAt),
    lastSeenAt: optionalDate(record.lastSeenAt),
    createdAt: new Date(record.createdAt),
  };
}

function toLocalPasswordCredentialInsert(
  record: LocalPasswordCredentialRecord,
): typeof localPasswordCredentials.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    emailNormalized: record.emailNormalized,
    passwordHash: record.passwordHash,
    failedAttemptCount: record.failedAttemptCount,
    lockedUntil: optionalDate(record.lockedUntil),
    passwordUpdatedAt: new Date(record.passwordUpdatedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toLocalMfaFactorInsert(
  record: LocalMfaFactorRecord,
): typeof localMfaFactors.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    type: record.type,
    name: record.name,
    status: record.status,
    secretEncrypted: record.secretEncrypted,
    confirmedAt: optionalDate(record.confirmedAt),
    disabledAt: optionalDate(record.disabledAt),
    lastUsedAt: optionalDate(record.lastUsedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toDeviceAuthorizationInsert(
  record: DeviceAuthorizationRecord,
): typeof deviceAuthorizations.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    name: record.name,
    scopes: record.scopes,
    hashedRefreshToken: record.hashedRefreshToken,
    accessApiKeyId: record.accessApiKeyId,
    expiresAt: new Date(record.expiresAt),
    revokedAt: optionalDate(record.revokedAt),
    lastRefreshedAt: optionalDate(record.lastRefreshedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function asScopes(values: string[]): ScopeRecord[] {
  return values.filter((value): value is ScopeRecord =>
    scopeValues.has(value as ScopeRecord),
  );
}
