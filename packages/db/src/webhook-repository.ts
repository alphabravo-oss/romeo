import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { RuntimeKeyUsageCounts, RuntimeKeyUsageQuery } from "@romeo/core";

import type { RomeoDatabase } from "./client";
import { webhookDeliveries, webhookSubscriptions } from "./schema";
import { optionalDate } from "./repository-mapping";
import {
  type ClaimedWebhookDeliveryRecord,
  type WebhookDeliveryCursorRecord,
  type WebhookDeliveryRecord,
  type WebhookSubscriptionRecord,
  toWebhookDeliveryInsert,
  toWebhookDeliveryRecord,
  toWebhookDeliveryUpdate,
  toWebhookSubscriptionInsert,
  toWebhookSubscriptionRecord,
} from "./webhook-repository-mapping";

export type {
  ClaimedWebhookDeliveryRecord,
  WebhookDeliveryCursorRecord,
  WebhookDeliveryRecord,
  WebhookDeliveryStatusRecord,
  WebhookEventTypeRecord,
  WebhookSubscriptionRecord,
} from "./webhook-repository-mapping";
export {
  toWebhookDeliveryRecord,
  toWebhookSubscriptionRecord,
} from "./webhook-repository-mapping";

export class PgWebhookRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listWebhookSubscriptions(
    orgId: string,
  ): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.orgId, orgId))
      .orderBy(
        desc(webhookSubscriptions.createdAt),
        asc(webhookSubscriptions.id),
      );
    return rows.map(toWebhookSubscriptionRecord);
  }

  async getWebhookSubscription(
    subscriptionId: string,
  ): Promise<WebhookSubscriptionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, subscriptionId))
      .limit(1);
    return row === undefined ? undefined : toWebhookSubscriptionRecord(row);
  }

  async createWebhookSubscription(
    subscription: WebhookSubscriptionRecord,
  ): Promise<WebhookSubscriptionRecord> {
    const [row] = await this.db
      .insert(webhookSubscriptions)
      .values(toWebhookSubscriptionInsert(subscription))
      .returning();
    return row === undefined ? subscription : toWebhookSubscriptionRecord(row);
  }

  async updateWebhookSubscription(
    subscription: WebhookSubscriptionRecord,
  ): Promise<WebhookSubscriptionRecord> {
    const [row] = await this.db
      .update(webhookSubscriptions)
      .set({
        disabledAt: optionalDate(subscription.disabledAt),
        eventTypes: subscription.eventTypes,
        updatedAt: new Date(subscription.updatedAt),
        url: subscription.url,
      })
      .where(eq(webhookSubscriptions.id, subscription.id))
      .returning();
    return row === undefined ? subscription : toWebhookSubscriptionRecord(row);
  }

  async listWebhookDeliveries(
    orgId: string,
    subscriptionId?: string,
  ): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        subscriptionId === undefined
          ? eq(webhookDeliveries.orgId, orgId)
          : and(
              eq(webhookDeliveries.orgId, orgId),
              eq(webhookDeliveries.subscriptionId, subscriptionId),
            ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), asc(webhookDeliveries.id));
    return rows.map(toWebhookDeliveryRecord);
  }

  async listWebhookDeliveriesPage(input: {
    cursor?: WebhookDeliveryCursorRecord;
    limit: number;
    orgId: string;
    subscriptionId?: string;
  }): Promise<WebhookDeliveryRecord[]> {
    const cursorWhere =
      input.cursor === undefined
        ? undefined
        : or(
            lt(webhookDeliveries.createdAt, new Date(input.cursor.createdAt)),
            and(
              eq(webhookDeliveries.createdAt, new Date(input.cursor.createdAt)),
              gt(webhookDeliveries.id, input.cursor.id),
            ),
          );
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.orgId, input.orgId),
          input.subscriptionId === undefined
            ? undefined
            : eq(webhookDeliveries.subscriptionId, input.subscriptionId),
          cursorWhere,
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), asc(webhookDeliveries.id))
      .limit(input.limit);
    return rows.map(toWebhookDeliveryRecord);
  }

  async countWebhookSigningKeyUsage(
    input: RuntimeKeyUsageQuery,
  ): Promise<RuntimeKeyUsageCounts> {
    const version = webhookDeliveries.signatureKeyVersion;
    const valid = sql`${version} ~ '^[a-f0-9]{16}$'`;
    const active =
      input.activeVersion === undefined
        ? sql`false`
        : sql`${version} = ${input.activeVersion}`;
    const previous =
      input.previousVersion === undefined
        ? sql`false`
        : sql`${version} = ${input.previousVersion}`;
    const [row] = await this.db
      .select({
        active:
          sql<number>`count(*) filter (where (${valid}) and (${active}))`.mapWith(
            Number,
          ),
        corrupt:
          sql<number>`count(*) filter (where ${version} is not null and not (${valid}))`.mapWith(
            Number,
          ),
        legacyUnversioned:
          sql<number>`count(*) filter (where ${version} is null)`.mapWith(
            Number,
          ),
        previous:
          sql<number>`count(*) filter (where (${valid}) and (${previous}))`.mapWith(
            Number,
          ),
        total: sql<number>`count(*)`.mapWith(Number),
        unknown:
          sql<number>`count(*) filter (where (${valid}) and not (${active}) and not (${previous}))`.mapWith(
            Number,
          ),
      })
      .from(webhookDeliveries)
      .where(
        input.orgId === undefined
          ? undefined
          : eq(webhookDeliveries.orgId, input.orgId),
      );
    return (
      row ?? {
        active: 0,
        corrupt: 0,
        legacyUnversioned: 0,
        previous: 0,
        total: 0,
        unknown: 0,
      }
    );
  }

  async claimWebhookDelivery(input: {
    deliveryId: string;
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    orgId: string;
  }): Promise<ClaimedWebhookDeliveryRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.id, input.deliveryId),
            eq(webhookDeliveries.orgId, input.orgId),
            eq(webhookDeliveries.status, "pending"),
            leaseAvailableAt(input.now),
          ),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const [claimed] = await transaction
        .update(webhookDeliveries)
        .set({
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
        })
        .where(eq(webhookDeliveries.id, candidate.id))
        .returning();
      return claimed === undefined
        ? undefined
        : claimedDelivery(claimed, input);
    });
  }

  async claimDueWebhookDeliveries(input: {
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    limit: number;
    maxAttempts: number;
    now: string;
    orgId: string;
  }): Promise<ClaimedWebhookDeliveryRecord[]> {
    return this.db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.orgId, input.orgId),
            eq(webhookDeliveries.status, "failed"),
            lte(webhookDeliveries.nextAttemptAt, new Date(input.now)),
            lt(webhookDeliveries.attemptCount, input.maxAttempts),
            leaseAvailableAt(input.now),
          ),
        )
        .orderBy(
          asc(webhookDeliveries.nextAttemptAt),
          asc(webhookDeliveries.createdAt),
          asc(webhookDeliveries.id),
        )
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      const rows = await transaction
        .update(webhookDeliveries)
        .set({
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
        })
        .where(
          inArray(
            webhookDeliveries.id,
            candidates.map((candidate) => candidate.id),
          ),
        )
        .returning();
      return rows.map((row) => claimedDelivery(row, input));
    });
  }

  async completeWebhookDeliveryAttempt(input: {
    delivery: WebhookDeliveryRecord;
    leaseOwner: string;
    leaseToken: string;
    now: string;
  }): Promise<WebhookDeliveryRecord | undefined> {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({
        ...toWebhookDeliveryUpdate(input.delivery),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(webhookDeliveries.id, input.delivery.id),
          eq(webhookDeliveries.orgId, input.delivery.orgId),
          eq(webhookDeliveries.leaseOwner, input.leaseOwner),
          eq(webhookDeliveries.leaseToken, input.leaseToken),
          gt(webhookDeliveries.leaseExpiresAt, new Date(input.now)),
        ),
      )
      .returning();
    return row === undefined ? undefined : toWebhookDeliveryRecord(row);
  }

  async createWebhookDelivery(
    delivery: WebhookDeliveryRecord,
  ): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values(toWebhookDeliveryInsert(delivery))
      .onConflictDoNothing({ target: webhookDeliveries.id })
      .returning();
    if (row !== undefined) return toWebhookDeliveryRecord(row);
    const [existing] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id))
      .limit(1);
    return existing === undefined
      ? delivery
      : toWebhookDeliveryRecord(existing);
  }

  async updateWebhookDelivery(
    delivery: WebhookDeliveryRecord,
  ): Promise<WebhookDeliveryRecord> {
    const [row] = await this.db
      .update(webhookDeliveries)
      .set(toWebhookDeliveryUpdate(delivery))
      .where(eq(webhookDeliveries.id, delivery.id))
      .returning();
    return row === undefined ? delivery : toWebhookDeliveryRecord(row);
  }
}

function leaseAvailableAt(now: string) {
  return or(
    isNull(webhookDeliveries.leaseExpiresAt),
    lte(webhookDeliveries.leaseExpiresAt, new Date(now)),
  );
}

function claimedDelivery(
  row: typeof webhookDeliveries.$inferSelect,
  lease: { leaseExpiresAt: string; leaseOwner: string; leaseToken: string },
): ClaimedWebhookDeliveryRecord {
  return {
    delivery: toWebhookDeliveryRecord(row),
    leaseExpiresAt: lease.leaseExpiresAt,
    leaseOwner: lease.leaseOwner,
    leaseToken: lease.leaseToken,
  };
}
