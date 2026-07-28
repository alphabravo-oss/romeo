import { asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { apiKeys, deviceAuthorizations, serviceAccounts } from "./schema";
import { optionalDate } from "./repository-mapping";
import {
  type ApiKeyRecord,
  type DeviceAuthorizationRecord,
  type ServiceAccountRecord,
  toApiKeyInsert,
  toApiKeyRecord,
  toDeviceAuthorizationInsert,
  toDeviceAuthorizationRecord,
  toServiceAccountInsert,
  toServiceAccountRecord,
} from "./auth-credential-records";
import { and } from "drizzle-orm";

export class PgApiAccessCredentialRepository {
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

  async createApiKey(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    const [row] = await this.db
      .insert(apiKeys)
      .values(toApiKeyInsert(record))
      .returning();
    return row === undefined ? record : toApiKeyRecord(row);
  }

  async updateApiKey(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    const [row] = await this.db
      .update(apiKeys)
      .set({
        name: record.name,
        revokedAt: optionalDate(record.revokedAt),
        scopes: record.scopes,
      })
      .where(eq(apiKeys.id, record.id))
      .returning();
    return row === undefined ? record : toApiKeyRecord(row);
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
    id: string,
  ): Promise<DeviceAuthorizationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.id, id))
      .limit(1);
    return row === undefined ? undefined : toDeviceAuthorizationRecord(row);
  }

  async getDeviceAuthorizationByRefreshHash(
    hash: string,
  ): Promise<DeviceAuthorizationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.hashedRefreshToken, hash))
      .limit(1);
    return row === undefined ? undefined : toDeviceAuthorizationRecord(row);
  }

  async createDeviceAuthorization(
    record: DeviceAuthorizationRecord,
  ): Promise<DeviceAuthorizationRecord> {
    const [row] = await this.db
      .insert(deviceAuthorizations)
      .values(toDeviceAuthorizationInsert(record))
      .returning();
    return row === undefined ? record : toDeviceAuthorizationRecord(row);
  }

  async updateDeviceAuthorization(
    record: DeviceAuthorizationRecord,
  ): Promise<DeviceAuthorizationRecord> {
    const [row] = await this.db
      .update(deviceAuthorizations)
      .set({
        accessApiKeyId: record.accessApiKeyId,
        expiresAt: new Date(record.expiresAt),
        hashedRefreshToken: record.hashedRefreshToken,
        lastRefreshedAt: optionalDate(record.lastRefreshedAt),
        name: record.name,
        revokedAt: optionalDate(record.revokedAt),
        scopes: record.scopes,
        updatedAt: new Date(record.updatedAt),
      })
      .where(eq(deviceAuthorizations.id, record.id))
      .returning();
    return row === undefined ? record : toDeviceAuthorizationRecord(row);
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
    id: string,
  ): Promise<ServiceAccountRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, id))
      .limit(1);
    return row === undefined ? undefined : toServiceAccountRecord(row);
  }

  async createServiceAccount(
    record: ServiceAccountRecord,
  ): Promise<ServiceAccountRecord> {
    const [row] = await this.db
      .insert(serviceAccounts)
      .values(toServiceAccountInsert(record))
      .returning();
    return row === undefined ? record : toServiceAccountRecord(row);
  }

  async updateServiceAccount(
    record: ServiceAccountRecord,
  ): Promise<ServiceAccountRecord> {
    const [row] = await this.db
      .update(serviceAccounts)
      .set({
        disabledAt: optionalDate(record.disabledAt),
        name: record.name,
        scopes: record.scopes,
      })
      .where(eq(serviceAccounts.id, record.id))
      .returning();
    return row === undefined ? record : toServiceAccountRecord(row);
  }
}
