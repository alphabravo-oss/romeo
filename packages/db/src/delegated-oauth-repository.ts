import { and, asc, desc, eq } from "drizzle-orm";

import type {
  DataConnectorType,
  DelegatedOAuthConnection,
  DelegatedOAuthConnectionStatus,
  DelegatedOAuthProviderId,
  DelegatedOAuthTokenEnvelope,
} from "@romeo/core";

import type { RomeoDatabase } from "./client";
import { delegatedOAuthConnections } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export class PgDelegatedOAuthRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listDelegatedOAuthConnections(
    orgId: string,
    workspaceId?: string,
    userId?: string,
  ): Promise<DelegatedOAuthConnection[]> {
    const rows = await this.db
      .select()
      .from(delegatedOAuthConnections)
      .where(
        and(
          eq(delegatedOAuthConnections.orgId, orgId),
          ...(workspaceId === undefined
            ? []
            : [eq(delegatedOAuthConnections.workspaceId, workspaceId)]),
          ...(userId === undefined
            ? []
            : [eq(delegatedOAuthConnections.userId, userId)]),
        ),
      )
      .orderBy(
        desc(delegatedOAuthConnections.updatedAt),
        asc(delegatedOAuthConnections.id),
      );
    return rows.map(toDelegatedOAuthConnectionRecord);
  }

  async getDelegatedOAuthConnection(
    connectionId: string,
  ): Promise<DelegatedOAuthConnection | undefined> {
    const [row] = await this.db
      .select()
      .from(delegatedOAuthConnections)
      .where(eq(delegatedOAuthConnections.id, connectionId))
      .limit(1);
    return row === undefined
      ? undefined
      : toDelegatedOAuthConnectionRecord(row);
  }

  async getDelegatedOAuthConnectionByProviderAccount(input: {
    connectorType: DataConnectorType;
    orgId: string;
    providerAccountId: string;
    providerId: DelegatedOAuthProviderId;
    userId: string;
    workspaceId: string;
  }): Promise<DelegatedOAuthConnection | undefined> {
    const [row] = await this.db
      .select()
      .from(delegatedOAuthConnections)
      .where(
        and(
          eq(delegatedOAuthConnections.orgId, input.orgId),
          eq(delegatedOAuthConnections.workspaceId, input.workspaceId),
          eq(delegatedOAuthConnections.userId, input.userId),
          eq(delegatedOAuthConnections.providerId, input.providerId),
          eq(delegatedOAuthConnections.connectorType, input.connectorType),
          eq(
            delegatedOAuthConnections.providerAccountId,
            input.providerAccountId,
          ),
        ),
      )
      .limit(1);
    return row === undefined
      ? undefined
      : toDelegatedOAuthConnectionRecord(row);
  }

  async createDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection> {
    const [row] = await this.db
      .insert(delegatedOAuthConnections)
      .values(toDelegatedOAuthConnectionInsert(connection))
      .returning();
    return row === undefined
      ? connection
      : toDelegatedOAuthConnectionRecord(row);
  }

  async updateDelegatedOAuthConnection(
    connection: DelegatedOAuthConnection,
  ): Promise<DelegatedOAuthConnection> {
    const [row] = await this.db
      .update(delegatedOAuthConnections)
      .set({
        accessTokenExpiresAt: optionalDate(connection.accessTokenExpiresAt),
        connectorType: connection.connectorType,
        providerAccountId: connection.providerAccountId,
        providerAccountLogin: connection.providerAccountLogin ?? null,
        providerId: connection.providerId,
        lastUsedAt: optionalDate(connection.lastUsedAt),
        refreshTokenExpiresAt: optionalDate(connection.refreshTokenExpiresAt),
        revokedAt: optionalDate(connection.revokedAt),
        scopes: connection.scopes,
        status: connection.status,
        token: connection.token,
        updatedAt: new Date(connection.updatedAt),
      })
      .where(eq(delegatedOAuthConnections.id, connection.id))
      .returning();
    return row === undefined
      ? connection
      : toDelegatedOAuthConnectionRecord(row);
  }
}

function toDelegatedOAuthConnectionRecord(
  row: typeof delegatedOAuthConnections.$inferSelect,
): DelegatedOAuthConnection {
  const connection: DelegatedOAuthConnection = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    userId: row.userId,
    providerId: asProviderId(row.providerId),
    connectorType: asConnectorType(row.connectorType),
    providerAccountId: row.providerAccountId,
    scopes: asStringArray(row.scopes),
    status: asStatus(row.status),
    token: asTokenEnvelope(row.token),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  if (row.providerAccountLogin !== null)
    connection.providerAccountLogin = row.providerAccountLogin;
  const accessTokenExpiresAt = optionalIsoString(row.accessTokenExpiresAt);
  if (accessTokenExpiresAt !== undefined)
    connection.accessTokenExpiresAt = accessTokenExpiresAt;
  const refreshTokenExpiresAt = optionalIsoString(row.refreshTokenExpiresAt);
  if (refreshTokenExpiresAt !== undefined)
    connection.refreshTokenExpiresAt = refreshTokenExpiresAt;
  const lastUsedAt = optionalIsoString(row.lastUsedAt);
  if (lastUsedAt !== undefined) connection.lastUsedAt = lastUsedAt;
  const revokedAt = optionalIsoString(row.revokedAt);
  if (revokedAt !== undefined) connection.revokedAt = revokedAt;
  return connection;
}

function toDelegatedOAuthConnectionInsert(
  connection: DelegatedOAuthConnection,
): typeof delegatedOAuthConnections.$inferInsert {
  return {
    id: connection.id,
    orgId: connection.orgId,
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    providerId: connection.providerId,
    connectorType: connection.connectorType,
    providerAccountId: connection.providerAccountId,
    providerAccountLogin: connection.providerAccountLogin ?? null,
    scopes: connection.scopes,
    status: connection.status,
    token: connection.token,
    accessTokenExpiresAt: optionalDate(connection.accessTokenExpiresAt),
    refreshTokenExpiresAt: optionalDate(connection.refreshTokenExpiresAt),
    lastUsedAt: optionalDate(connection.lastUsedAt),
    revokedAt: optionalDate(connection.revokedAt),
    createdAt: new Date(connection.createdAt),
    updatedAt: new Date(connection.updatedAt),
  };
}

function asProviderId(value: string): DelegatedOAuthProviderId {
  if (value === "github") return value;
  throw new Error(`Unsupported delegated OAuth provider: ${value}`);
}

function asConnectorType(value: string): DataConnectorType {
  if (
    value === "github" ||
    value === "local_import" ||
    value === "rss" ||
    value === "s3" ||
    value === "website"
  ) {
    return value;
  }
  throw new Error(`Unsupported delegated OAuth connector type: ${value}`);
}

function asStatus(value: string): DelegatedOAuthConnectionStatus {
  if (
    value === "active" ||
    value === "reauthorization_required" ||
    value === "revoked"
  ) {
    return value;
  }
  throw new Error(`Unsupported delegated OAuth status: ${value}`);
}

function asTokenEnvelope(value: unknown): DelegatedOAuthTokenEnvelope {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { v?: unknown }).v === 1 &&
    (value as { alg?: unknown }).alg === "A256GCM" &&
    typeof (value as { ciphertext?: unknown }).ciphertext === "string" &&
    typeof (value as { iv?: unknown }).iv === "string" &&
    typeof (value as { tag?: unknown }).tag === "string" &&
    typeof (value as { createdAt?: unknown }).createdAt === "string"
  ) {
    return value as DelegatedOAuthTokenEnvelope;
  }
  throw new Error("Delegated OAuth token envelope is invalid.");
}
