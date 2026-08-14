import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type {
  AuthorizedFileCatalogQuery,
  ClaimFileLifecycleInput,
  FileObjectPurpose,
  FileObjectStatus,
  FinishFileLifecycleLeaseInput,
  RenewFileLifecycleLeaseInput,
} from "@romeo/core";
import { assertFileLifecycleTransition } from "@romeo/core";

import type { RomeoDatabase } from "./client";
import {
  lifecycleVersionConflict,
  toFileObjectInsert,
  toFileObjectRecord,
  toFileObjectUpdate,
} from "./file-record-mapping";
import { objectRecords, resourceGrants } from "./schema";
import { containsPattern } from "./like-pattern";

export interface FileObjectRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  ownerType: "service_account" | "user";
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  objectKey: string;
  purpose: FileObjectPurpose;
  status: FileObjectStatus;
  lifecycleVersion?: number;
  lifecycleAttempts?: number;
  lifecycleFailureCode?: string;
  lifecycleNextAttemptAt?: string;
  lifecycleLeaseOwner?: string;
  lifecycleLeaseToken?: string;
  lifecycleLeaseExpiresAt?: string;
  attachedAt?: string;
  retainedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export class PgFileRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listFileObjects(
    orgId: string,
    workspaceId?: string,
  ): Promise<FileObjectRecord[]> {
    const rows = await this.db
      .select()
      .from(objectRecords)
      .where(
        workspaceId === undefined
          ? eq(objectRecords.orgId, orgId)
          : and(
              eq(objectRecords.orgId, orgId),
              eq(objectRecords.workspaceId, workspaceId),
            ),
      )
      .orderBy(desc(objectRecords.updatedAt), asc(objectRecords.id));
    return rows.map(toFileObjectRecord);
  }

  async listAuthorizedFileObjectsPage(
    input: AuthorizedFileCatalogQuery,
  ): Promise<{ items: FileObjectRecord[]; total: number }> {
    const principalMatch = or(
      and(
        eq(resourceGrants.principalType, input.principalType),
        eq(resourceGrants.principalId, input.principalId),
      ),
      input.groupIds.length === 0
        ? undefined
        : and(
            eq(resourceGrants.principalType, "group"),
            inArray(resourceGrants.principalId, input.groupIds),
          ),
    );
    const grantMatch = exists(
      this.db
        .select({ value: sql`1` })
        .from(resourceGrants)
        .where(
          and(
            eq(resourceGrants.orgId, input.orgId),
            eq(resourceGrants.resourceType, "file"),
            eq(resourceGrants.resourceId, objectRecords.id),
            inArray(resourceGrants.permission, ["read", "write"]),
            principalMatch,
          ),
        ),
    );
    const ownerMatch = and(
      eq(objectRecords.ownerType, input.principalType),
      eq(objectRecords.ownerId, input.principalId),
    );
    const query = input.query?.trim();
    const predicate = and(
      eq(objectRecords.orgId, input.orgId),
      eq(objectRecords.workspaceId, input.workspaceId),
      ne(objectRecords.status, "deleted"),
      input.purposes === undefined
        ? undefined
        : inArray(objectRecords.purpose, input.purposes),
      input.excludePurposes === undefined
        ? undefined
        : notInArray(objectRecords.purpose, input.excludePurposes),
      query === undefined || query === ""
        ? undefined
        : or(
            ilike(objectRecords.fileName, containsPattern(query)),
            ilike(objectRecords.mimeType, containsPattern(query)),
            ilike(sql`${objectRecords.metadata}->>'title'`, containsPattern(query)),
          ),
      input.isAdmin
        ? undefined
        : input.accessMode === "workspace_content"
          ? or(
              ownerMatch,
              sql`${objectRecords.metadata}->>'scope' = 'workspace'`,
            )
          : or(ownerMatch, grantMatch),
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(objectRecords)
        .where(predicate)
        .orderBy(desc(objectRecords.updatedAt), asc(objectRecords.id))
        .limit(input.limit)
        .offset(input.offset),
      this.db.select({ value: count() }).from(objectRecords).where(predicate),
    ]);
    return {
      items: rows.map(toFileObjectRecord),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async getFileObject(fileId: string): Promise<FileObjectRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(objectRecords)
      .where(eq(objectRecords.id, fileId))
      .limit(1);
    return row === undefined ? undefined : toFileObjectRecord(row);
  }

  async createFileObject(file: FileObjectRecord): Promise<FileObjectRecord> {
    const [row] = await this.db
      .insert(objectRecords)
      .values(toFileObjectInsert(file))
      .returning();
    return row === undefined ? file : toFileObjectRecord(row);
  }

  async updateFileObject(file: FileObjectRecord): Promise<FileObjectRecord> {
    const current = await this.getFileObject(file.id);
    if (current === undefined) return file;
    assertFileLifecycleTransition(current, file);
    const [row] = await this.db
      .update(objectRecords)
      .set(toFileObjectUpdate(file))
      .where(
        and(
          eq(objectRecords.id, file.id),
          eq(objectRecords.lifecycleVersion, current.lifecycleVersion ?? 0),
        ),
      )
      .returning();
    if (row === undefined) throw lifecycleVersionConflict();
    return toFileObjectRecord(row);
  }

  async claimNextFileLifecycle(
    input: ClaimFileLifecycleInput,
  ): Promise<FileObjectRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      const now = new Date(input.now);
      const [candidate] = await transaction
        .select()
        .from(objectRecords)
        .where(
          and(
            inArray(objectRecords.status, [
              "quarantined",
              "scanning",
              "extracting",
              "transcoding",
              "failed",
            ]),
            lte(objectRecords.lifecycleAttempts, 99),
            or(
              isNull(objectRecords.lifecycleNextAttemptAt),
              lte(objectRecords.lifecycleNextAttemptAt, now),
            ),
            or(
              isNull(objectRecords.lifecycleLeaseExpiresAt),
              lte(objectRecords.lifecycleLeaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(
          asc(objectRecords.lifecycleNextAttemptAt),
          asc(objectRecords.updatedAt),
          asc(objectRecords.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const current = toFileObjectRecord(candidate);
      const claimed: FileObjectRecord = {
        ...current,
        status: current.status === "failed" ? "quarantined" : current.status,
        lifecycleVersion: (current.lifecycleVersion ?? 0) + 1,
        lifecycleAttempts: (current.lifecycleAttempts ?? 0) + 1,
        lifecycleLeaseOwner: input.leaseOwner,
        lifecycleLeaseToken: input.leaseToken,
        lifecycleLeaseExpiresAt: input.leaseExpiresAt,
        updatedAt: input.now,
      };
      delete claimed.lifecycleFailureCode;
      delete claimed.lifecycleNextAttemptAt;
      assertFileLifecycleTransition(current, claimed);
      const [row] = await transaction
        .update(objectRecords)
        .set({
          status: claimed.status,
          lifecycleVersion: candidate.lifecycleVersion + 1,
          lifecycleAttempts: candidate.lifecycleAttempts + 1,
          lifecycleFailureCode: null,
          lifecycleNextAttemptAt: null,
          lifecycleLeaseOwner: input.leaseOwner,
          lifecycleLeaseToken: input.leaseToken,
          lifecycleLeaseExpiresAt: new Date(input.leaseExpiresAt),
          updatedAt: now,
        })
        .where(
          and(
            eq(objectRecords.id, candidate.id),
            eq(objectRecords.lifecycleVersion, candidate.lifecycleVersion),
          ),
        )
        .returning();
      return row === undefined ? undefined : toFileObjectRecord(row);
    });
  }

  async renewFileLifecycleLease(
    input: RenewFileLifecycleLeaseInput,
  ): Promise<FileObjectRecord | undefined> {
    const now = new Date(input.now);
    const [row] = await this.db
      .update(objectRecords)
      .set({
        lifecycleVersion: sql`${objectRecords.lifecycleVersion} + 1`,
        lifecycleLeaseExpiresAt: new Date(input.leaseExpiresAt),
        updatedAt: now,
      })
      .where(
        and(
          eq(objectRecords.id, input.fileId),
          eq(objectRecords.lifecycleLeaseOwner, input.leaseOwner),
          eq(objectRecords.lifecycleLeaseToken, input.leaseToken),
          gt(objectRecords.lifecycleLeaseExpiresAt, now),
        ),
      )
      .returning();
    return row === undefined ? undefined : toFileObjectRecord(row);
  }

  async advanceFileLifecycleLease(
    input: FinishFileLifecycleLeaseInput,
  ): Promise<FileObjectRecord | undefined> {
    return this.writeClaimedFileLifecycle(input, false);
  }

  async finishFileLifecycleLease(
    input: FinishFileLifecycleLeaseInput,
  ): Promise<FileObjectRecord | undefined> {
    return this.writeClaimedFileLifecycle(input, true);
  }

  private async writeClaimedFileLifecycle(
    input: FinishFileLifecycleLeaseInput,
    clearLease: boolean,
  ): Promise<FileObjectRecord | undefined> {
    const current = await this.getFileObject(input.file.id);
    if (current === undefined) return undefined;
    if (
      (input.file.lifecycleVersion ?? 0) !==
      (current.lifecycleVersion ?? 0) + 1
    )
      return undefined;
    assertFileLifecycleTransition(current, input.file);
    const now = new Date(input.now);
    const completed = { ...input.file };
    if (clearLease) {
      delete completed.lifecycleLeaseOwner;
      delete completed.lifecycleLeaseToken;
      delete completed.lifecycleLeaseExpiresAt;
    }
    const [row] = await this.db
      .update(objectRecords)
      .set(toFileObjectUpdate(completed))
      .where(
        and(
          eq(objectRecords.id, input.file.id),
          eq(objectRecords.lifecycleVersion, current.lifecycleVersion ?? 0),
          eq(objectRecords.lifecycleLeaseOwner, input.leaseOwner),
          eq(objectRecords.lifecycleLeaseToken, input.leaseToken),
          gt(objectRecords.lifecycleLeaseExpiresAt, now),
        ),
      )
      .returning();
    return row === undefined ? undefined : toFileObjectRecord(row);
  }
}

export { toFileObjectRecord } from "./file-record-mapping";
