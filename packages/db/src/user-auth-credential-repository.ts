import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  localMfaFactors,
  localPasswordCredentials,
  userSessions,
} from "./schema";
import { optionalDate } from "./repository-mapping";
import {
  type LocalMfaFactorRecord,
  type LocalPasswordCredentialRecord,
  type UserSessionRecord,
  toLocalMfaFactorInsert,
  toLocalMfaFactorRecord,
  toLocalPasswordCredentialInsert,
  toLocalPasswordCredentialRecord,
  toUserSessionInsert,
  toUserSessionRecord,
} from "./auth-credential-records";

export class PgUserAuthCredentialRepository {
  constructor(private readonly db: RomeoDatabase) {}

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

  async getUserSession(id: string): Promise<UserSessionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, id))
      .limit(1);
    return row === undefined ? undefined : toUserSessionRecord(row);
  }

  async getUserSessionByHash(
    hash: string,
  ): Promise<UserSessionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.hashedToken, hash))
      .limit(1);
    return row === undefined ? undefined : toUserSessionRecord(row);
  }

  async createUserSession(
    record: UserSessionRecord,
  ): Promise<UserSessionRecord> {
    const [row] = await this.db
      .insert(userSessions)
      .values(toUserSessionInsert(record))
      .returning();
    return row === undefined ? record : toUserSessionRecord(row);
  }

  async updateUserSession(
    record: UserSessionRecord,
  ): Promise<UserSessionRecord> {
    const [row] = await this.db
      .update(userSessions)
      .set({
        expiresAt: new Date(record.expiresAt),
        isAdmin: record.isAdmin,
        lastSeenAt: optionalDate(record.lastSeenAt),
        name: record.name,
        revokedAt: optionalDate(record.revokedAt),
        scopes: record.scopes,
      })
      .where(eq(userSessions.id, record.id))
      .returning();
    return row === undefined ? record : toUserSessionRecord(row);
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
    record: LocalPasswordCredentialRecord,
  ): Promise<LocalPasswordCredentialRecord> {
    const [row] = await this.db
      .insert(localPasswordCredentials)
      .values(toLocalPasswordCredentialInsert(record))
      .returning();
    return row === undefined ? record : toLocalPasswordCredentialRecord(row);
  }

  async updateLocalPasswordCredential(
    record: LocalPasswordCredentialRecord,
  ): Promise<LocalPasswordCredentialRecord> {
    const [row] = await this.db
      .update(localPasswordCredentials)
      .set({
        emailNormalized: record.emailNormalized,
        failedAttemptCount: record.failedAttemptCount,
        lockedUntil: optionalDate(record.lockedUntil),
        passwordHash: record.passwordHash,
        passwordUpdatedAt: new Date(record.passwordUpdatedAt),
        updatedAt: new Date(record.updatedAt),
      })
      .where(eq(localPasswordCredentials.id, record.id))
      .returning();
    return row === undefined ? record : toLocalPasswordCredentialRecord(row);
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
    id: string,
  ): Promise<LocalMfaFactorRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(localMfaFactors)
      .where(eq(localMfaFactors.id, id))
      .limit(1);
    return row === undefined ? undefined : toLocalMfaFactorRecord(row);
  }

  async createLocalMfaFactor(
    record: LocalMfaFactorRecord,
  ): Promise<LocalMfaFactorRecord> {
    const [row] = await this.db
      .insert(localMfaFactors)
      .values(toLocalMfaFactorInsert(record))
      .returning();
    return row === undefined ? record : toLocalMfaFactorRecord(row);
  }

  async updateLocalMfaFactor(
    record: LocalMfaFactorRecord,
  ): Promise<LocalMfaFactorRecord> {
    const [row] = await this.db
      .update(localMfaFactors)
      .set({
        confirmedAt: optionalDate(record.confirmedAt),
        disabledAt: optionalDate(record.disabledAt),
        lastUsedAt: optionalDate(record.lastUsedAt),
        name: record.name,
        secretEncrypted: record.secretEncrypted,
        status: record.status,
        updatedAt: new Date(record.updatedAt),
      })
      .where(eq(localMfaFactors.id, record.id))
      .returning();
    return row === undefined ? record : toLocalMfaFactorRecord(row);
  }
}
