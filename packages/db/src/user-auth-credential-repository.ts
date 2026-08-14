import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  localMfaFactors,
  localMfaChallenges,
  localPasswordCredentials,
  samlAuthRequests,
  userSessions,
} from "./schema";
import { optionalDate } from "./repository-mapping";
import {
  type LocalMfaFactorRecord,
  type LocalMfaChallengeRecord,
  type LocalPasswordCredentialRecord,
  type SamlAuthRequestRecord,
  type UserSessionRecord,
  toLocalMfaFactorInsert,
  toLocalMfaFactorRecord,
  toLocalMfaChallengeRecord,
  toLocalPasswordCredentialInsert,
  toLocalPasswordCredentialRecord,
  toSamlAuthRequestRecord,
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

  async recordFailedLocalPasswordAttempt(input: {
    credentialId: string;
    attemptedAt: string;
    lockedUntil: string;
    maxFailedAttempts: number;
  }): Promise<LocalPasswordCredentialRecord | undefined> {
    const [row] = await this.db
      .update(localPasswordCredentials)
      .set({
        failedAttemptCount: sql`${localPasswordCredentials.failedAttemptCount} + 1`,
        lockedUntil: sql`case when ${localPasswordCredentials.failedAttemptCount} + 1 >= ${input.maxFailedAttempts} then ${input.lockedUntil}::timestamptz else ${localPasswordCredentials.lockedUntil} end`,
        updatedAt: new Date(input.attemptedAt),
      })
      .where(eq(localPasswordCredentials.id, input.credentialId))
      .returning();
    return row === undefined ? undefined : toLocalPasswordCredentialRecord(row);
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

  async consumeLocalMfaFactor(input: {
    factor: LocalMfaFactorRecord;
    expectedSecretEncrypted: string;
  }): Promise<LocalMfaFactorRecord | undefined> {
    const [row] = await this.db
      .update(localMfaFactors)
      .set({
        disabledAt: optionalDate(input.factor.disabledAt),
        lastUsedAt: optionalDate(input.factor.lastUsedAt),
        secretEncrypted: input.factor.secretEncrypted,
        status: input.factor.status,
        updatedAt: new Date(input.factor.updatedAt),
      })
      .where(
        and(
          eq(localMfaFactors.id, input.factor.id),
          eq(localMfaFactors.secretEncrypted, input.expectedSecretEncrypted),
          eq(localMfaFactors.status, "active"),
        ),
      )
      .returning();
    return row === undefined ? undefined : toLocalMfaFactorRecord(row);
  }

  async createSamlAuthRequest(
    request: SamlAuthRequestRecord,
  ): Promise<SamlAuthRequestRecord> {
    const [row] = await this.db
      .insert(samlAuthRequests)
      .values({
        id: request.id,
        orgId: request.orgId,
        providerId: request.providerId,
        relayStateHash: request.relayStateHash,
        requestInstant: new Date(request.requestInstant),
        expiresAt: new Date(request.expiresAt),
        consumedAt: optionalDate(request.consumedAt),
        createdAt: new Date(request.createdAt),
      })
      .returning();
    if (row === undefined)
      throw new Error("SAML authentication request was not created.");
    return toSamlAuthRequestRecord(row);
  }

  async createLocalMfaChallenge(
    challenge: LocalMfaChallengeRecord,
  ): Promise<LocalMfaChallengeRecord> {
    const [row] = await this.db
      .insert(localMfaChallenges)
      .values({
        id: challenge.id,
        orgId: challenge.orgId,
        userId: challenge.userId,
        expiresAt: new Date(challenge.expiresAt),
        consumedAt: optionalDate(challenge.consumedAt),
        createdAt: new Date(challenge.createdAt),
      })
      .returning();
    if (row === undefined)
      throw new Error("Local MFA challenge was not created.");
    return toLocalMfaChallengeRecord(row);
  }

  async consumeLocalMfaChallenge(input: {
    id: string;
    orgId: string;
    userId: string;
    consumedAt: string;
  }): Promise<LocalMfaChallengeRecord | undefined> {
    const consumedAt = new Date(input.consumedAt);
    const [row] = await this.db
      .update(localMfaChallenges)
      .set({ consumedAt })
      .where(
        and(
          eq(localMfaChallenges.id, input.id),
          eq(localMfaChallenges.orgId, input.orgId),
          eq(localMfaChallenges.userId, input.userId),
          isNull(localMfaChallenges.consumedAt),
          gt(localMfaChallenges.expiresAt, consumedAt),
        ),
      )
      .returning();
    return row === undefined ? undefined : toLocalMfaChallengeRecord(row);
  }

  async consumeSamlAuthRequest(input: {
    id: string;
    orgId: string;
    providerId: "saml";
    relayStateHash: string;
    consumedAt: string;
  }): Promise<SamlAuthRequestRecord | undefined> {
    const consumedAt = new Date(input.consumedAt);
    const [row] = await this.db
      .update(samlAuthRequests)
      .set({ consumedAt })
      .where(
        and(
          eq(samlAuthRequests.id, input.id),
          eq(samlAuthRequests.orgId, input.orgId),
          eq(samlAuthRequests.providerId, input.providerId),
          eq(samlAuthRequests.relayStateHash, input.relayStateHash),
          isNull(samlAuthRequests.consumedAt),
          gt(samlAuthRequests.expiresAt, consumedAt),
        ),
      )
      .returning();
    return row === undefined ? undefined : toSamlAuthRequestRecord(row);
  }
}
