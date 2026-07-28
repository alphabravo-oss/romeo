import type { RomeoDatabase } from "./client";
import { PgApiAccessCredentialRepository } from "./api-access-credential-repository";
import { PgUserAuthCredentialRepository } from "./user-auth-credential-repository";
import type {
  ApiKeyRecord,
  DeviceAuthorizationRecord,
  ServiceAccountRecord,
} from "./auth-credential-records";

export * from "./auth-credential-records";

/** Stable repository façade for all persisted authentication credentials. */
export class PgAuthCredentialRepository extends PgUserAuthCredentialRepository {
  private readonly apiAccess: PgApiAccessCredentialRepository;

  constructor(db: RomeoDatabase) {
    super(db);
    this.apiAccess = new PgApiAccessCredentialRepository(db);
  }

  listApiKeys(orgId: string): Promise<ApiKeyRecord[]> {
    return this.apiAccess.listApiKeys(orgId);
  }

  getApiKey(id: string): Promise<ApiKeyRecord | undefined> {
    return this.apiAccess.getApiKey(id);
  }

  getApiKeyByHash(hash: string): Promise<ApiKeyRecord | undefined> {
    return this.apiAccess.getApiKeyByHash(hash);
  }

  createApiKey(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    return this.apiAccess.createApiKey(record);
  }

  updateApiKey(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    return this.apiAccess.updateApiKey(record);
  }

  listDeviceAuthorizations(
    orgId: string,
    userId: string,
  ): Promise<DeviceAuthorizationRecord[]> {
    return this.apiAccess.listDeviceAuthorizations(orgId, userId);
  }

  getDeviceAuthorization(
    id: string,
  ): Promise<DeviceAuthorizationRecord | undefined> {
    return this.apiAccess.getDeviceAuthorization(id);
  }

  getDeviceAuthorizationByRefreshHash(
    hash: string,
  ): Promise<DeviceAuthorizationRecord | undefined> {
    return this.apiAccess.getDeviceAuthorizationByRefreshHash(hash);
  }

  createDeviceAuthorization(
    record: DeviceAuthorizationRecord,
  ): Promise<DeviceAuthorizationRecord> {
    return this.apiAccess.createDeviceAuthorization(record);
  }

  updateDeviceAuthorization(
    record: DeviceAuthorizationRecord,
  ): Promise<DeviceAuthorizationRecord> {
    return this.apiAccess.updateDeviceAuthorization(record);
  }

  listServiceAccounts(orgId: string): Promise<ServiceAccountRecord[]> {
    return this.apiAccess.listServiceAccounts(orgId);
  }

  getServiceAccount(id: string): Promise<ServiceAccountRecord | undefined> {
    return this.apiAccess.getServiceAccount(id);
  }

  createServiceAccount(
    record: ServiceAccountRecord,
  ): Promise<ServiceAccountRecord> {
    return this.apiAccess.createServiceAccount(record);
  }

  updateServiceAccount(
    record: ServiceAccountRecord,
  ): Promise<ServiceAccountRecord> {
    return this.apiAccess.updateServiceAccount(record);
  }
}
