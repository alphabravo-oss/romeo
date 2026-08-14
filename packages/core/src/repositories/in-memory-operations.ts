import type * as Auth from "@romeo/auth";

import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { append, removeById, replaceById } from "./collection-helpers";
import {
  applyWorkerLease,
  compareWebhookDeliveries,
  payloadEquals,
  readWorkerLease,
  renewWorkerLease,
} from "./in-memory-operation-helpers";
import { listSeedResourceGrants } from "./resource-grants";
import { InMemoryIdempotencyRepository } from "./in-memory-idempotency";
import { assertUsageEventTaxonomy } from "../usage-taxonomy-validation";
import { assertUsageEventUpdate } from "../usage-taxonomy-update";

export abstract class InMemoryOperationsRepository extends InMemoryIdempotencyRepository {
  async listUsageEvents(orgId: string): Promise<E.UsageEvent[]> {
    return this.data.usageEvents
      .filter((event) => event.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listUsageEventsForRun(
    orgId: string,
    workspaceId: string,
    runId: string,
    limit: number,
  ): Promise<E.UsageEvent[]> {
    return this.data.usageEvents
      .filter(
        (event) =>
          event.orgId === orgId &&
          event.workspaceId === workspaceId &&
          event.sourceType === "run" &&
          event.sourceId === runId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(0, limit));
  }

  async createUsageEvent(event: E.UsageEvent): Promise<E.UsageEvent> {
    assertUsageEventTaxonomy(event);
    return append(this.data.usageEvents, event);
  }

  async updateUsageEvent(event: E.UsageEvent): Promise<E.UsageEvent> {
    const current = this.data.usageEvents.find(
      (candidate) => candidate.id === event.id,
    );
    if (current === undefined)
      throw new Error(`Usage event ${event.id} does not exist.`);
    assertUsageEventUpdate(current, event);
    this.data.usageEvents = this.data.usageEvents.map((candidate) =>
      candidate.id === event.id ? event : candidate,
    );
    return event;
  }

  async listBackgroundJobs(orgId: string): Promise<E.BackgroundJob[]> {
    return this.data.backgroundJobs
      .filter((job) => job.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createBackgroundJob(job: E.BackgroundJob): Promise<E.BackgroundJob> {
    if (this.data.backgroundJobs.some((candidate) => candidate.id === job.id)) {
      throw new Error(`Background job ${job.id} already exists.`);
    }
    return append(this.data.backgroundJobs, job);
  }

  async claimBackgroundJob(
    input: R.ClaimBackgroundJobInput,
  ): Promise<E.BackgroundJob | undefined> {
    const now = input.now ?? new Date().toISOString();
    const staleBeforeMs =
      Date.parse(now) - Math.max(1, input.leaseSeconds) * 1000;
    const job = this.data.backgroundJobs
      .filter((item) => item.orgId === input.orgId && item.type === input.type)
      .filter((item) => payloadEquals(item.payload, input.payloadEquals))
      .filter(
        (item) =>
          item.status === "queued" ||
          (item.status === "running" &&
            Date.parse(item.updatedAt) <= staleBeforeMs),
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      )[0];
    if (job === undefined) return undefined;
    return this.updateBackgroundJob(applyWorkerLease(job, input, now));
  }

  async renewBackgroundJobLease(
    input: R.RenewBackgroundJobLeaseInput,
  ): Promise<E.BackgroundJob | undefined> {
    const job = this.data.backgroundJobs.find(
      (item) => item.id === input.jobId && item.orgId === input.orgId,
    );
    if (job === undefined || job.status !== "running") return undefined;
    const now = input.now ?? new Date().toISOString();
    const lease = readWorkerLease(job.payload);
    if (
      lease === undefined ||
      lease.workerId !== input.workerId ||
      Date.parse(lease.expiresAt) <= Date.parse(now)
    ) {
      return undefined;
    }
    return this.updateBackgroundJob(renewWorkerLease(job, input, now, lease));
  }

  async updateBackgroundJob(job: E.BackgroundJob): Promise<E.BackgroundJob> {
    return replaceById(this.data.backgroundJobs, job);
  }

  async updateBackgroundJobWithLease(
    input: R.UpdateBackgroundJobWithLeaseInput,
  ): Promise<E.BackgroundJob | undefined> {
    const current = this.data.backgroundJobs.find(
      (job) => job.id === input.job.id && job.orgId === input.job.orgId,
    );
    if (current === undefined || current.status !== "running") return undefined;
    const lease = readWorkerLease(current.payload);
    const now = input.now ?? new Date().toISOString();
    if (
      lease === undefined ||
      lease.workerId !== input.workerId ||
      Date.parse(lease.expiresAt) <= Date.parse(now)
    )
      return undefined;
    return this.updateBackgroundJob({
      ...input.job,
      payload: { ...input.job.payload, workerLease: lease },
    });
  }

  async listWebhookSubscriptions(
    orgId: string,
  ): Promise<E.WebhookSubscription[]> {
    return this.data.webhookSubscriptions
      .filter((subscription) => subscription.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createWebhookSubscription(
    subscription: E.WebhookSubscription,
  ): Promise<E.WebhookSubscription> {
    return append(this.data.webhookSubscriptions, subscription);
  }

  async updateWebhookSubscription(
    subscription: E.WebhookSubscription,
  ): Promise<E.WebhookSubscription> {
    return replaceById(this.data.webhookSubscriptions, subscription);
  }

  async getWebhookSubscription(
    subscriptionId: string,
  ): Promise<E.WebhookSubscription | undefined> {
    return this.data.webhookSubscriptions.find(
      (subscription) => subscription.id === subscriptionId,
    );
  }

  async listWebhookDeliveries(
    orgId: string,
    subscriptionId?: string,
  ): Promise<E.WebhookDelivery[]> {
    return this.data.webhookDeliveries
      .filter(
        (delivery) =>
          delivery.orgId === orgId &&
          (subscriptionId === undefined ||
            delivery.subscriptionId === subscriptionId),
      )
      .sort(compareWebhookDeliveries);
  }

  async listWebhookDeliveriesPage(
    input: R.ListWebhookDeliveriesPageInput,
  ): Promise<E.WebhookDelivery[]> {
    return this.data.webhookDeliveries
      .filter(
        (delivery) =>
          delivery.orgId === input.orgId &&
          (input.subscriptionId === undefined ||
            delivery.subscriptionId === input.subscriptionId) &&
          (input.cursor === undefined ||
            delivery.createdAt < input.cursor.createdAt ||
            (delivery.createdAt === input.cursor.createdAt &&
              delivery.id > input.cursor.id)),
      )
      .sort(compareWebhookDeliveries)
      .slice(0, input.limit);
  }

  async claimWebhookDelivery(
    input: R.ClaimWebhookDeliveryInput,
  ): Promise<R.ClaimedWebhookDelivery | undefined> {
    const delivery = this.data.webhookDeliveries.find(
      (candidate) =>
        candidate.id === input.deliveryId &&
        candidate.orgId === input.orgId &&
        candidate.status === "pending",
    );
    if (delivery === undefined || !this.leaseAvailable(delivery.id, input.now))
      return undefined;
    return this.claimDelivery(delivery, input);
  }

  async claimDueWebhookDeliveries(
    input: R.ClaimDueWebhookDeliveriesInput,
  ): Promise<R.ClaimedWebhookDelivery[]> {
    return this.data.webhookDeliveries
      .filter(
        (delivery) =>
          delivery.orgId === input.orgId &&
          delivery.status === "failed" &&
          delivery.nextAttemptAt !== undefined &&
          delivery.nextAttemptAt <= input.now &&
          delivery.attemptCount < input.maxAttempts &&
          this.leaseAvailable(delivery.id, input.now),
      )
      .sort((left, right) =>
        left.nextAttemptAt === right.nextAttemptAt
          ? left.createdAt === right.createdAt
            ? left.id.localeCompare(right.id)
            : left.createdAt.localeCompare(right.createdAt)
          : left.nextAttemptAt!.localeCompare(right.nextAttemptAt!),
      )
      .slice(0, input.limit)
      .map((delivery) => this.claimDelivery(delivery, input));
  }

  async completeWebhookDeliveryAttempt(
    input: R.CompleteWebhookDeliveryAttemptInput,
  ): Promise<E.WebhookDelivery | undefined> {
    const lease = this.webhookDeliveryLeases.get(input.delivery.id);
    if (
      lease === undefined ||
      lease.leaseOwner !== input.leaseOwner ||
      lease.leaseToken !== input.leaseToken ||
      lease.leaseExpiresAt <= input.now
    )
      return undefined;
    const current = this.data.webhookDeliveries.find(
      (delivery) =>
        delivery.id === input.delivery.id &&
        delivery.orgId === input.delivery.orgId,
    );
    if (current === undefined) return undefined;
    this.webhookDeliveryLeases.delete(input.delivery.id);
    return replaceById(this.data.webhookDeliveries, input.delivery);
  }

  private leaseAvailable(deliveryId: string, now: string): boolean {
    const lease = this.webhookDeliveryLeases.get(deliveryId);
    return lease === undefined || lease.leaseExpiresAt <= now;
  }

  private claimDelivery(
    delivery: E.WebhookDelivery,
    input: {
      leaseExpiresAt: string;
      leaseOwner: string;
      leaseToken: string;
    },
  ): R.ClaimedWebhookDelivery {
    const lease = {
      leaseExpiresAt: input.leaseExpiresAt,
      leaseOwner: input.leaseOwner,
      leaseToken: input.leaseToken,
    };
    this.webhookDeliveryLeases.set(delivery.id, lease);
    return { delivery, ...lease };
  }

  async createWebhookDelivery(
    delivery: E.WebhookDelivery,
  ): Promise<E.WebhookDelivery> {
    return (
      this.data.webhookDeliveries.find(
        (candidate) => candidate.id === delivery.id,
      ) ?? append(this.data.webhookDeliveries, delivery)
    );
  }

  async updateWebhookDelivery(
    delivery: E.WebhookDelivery,
  ): Promise<E.WebhookDelivery> {
    return replaceById(this.data.webhookDeliveries, delivery);
  }

  async listWorkflowDefinitions(
    orgId: string,
    workspaceId?: string,
  ): Promise<E.WorkflowDefinition[]> {
    return this.data.workflowDefinitions
      .filter(
        (workflow) =>
          workflow.orgId === orgId &&
          (workspaceId === undefined || workflow.workspaceId === workspaceId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getWorkflowDefinition(
    workflowId: string,
  ): Promise<E.WorkflowDefinition | undefined> {
    return this.data.workflowDefinitions.find(
      (workflow) => workflow.id === workflowId,
    );
  }

  async createWorkflowDefinition(
    workflow: E.WorkflowDefinition,
  ): Promise<E.WorkflowDefinition> {
    return append(this.data.workflowDefinitions, workflow);
  }

  async updateWorkflowDefinition(
    workflow: E.WorkflowDefinition,
  ): Promise<E.WorkflowDefinition> {
    return replaceById(this.data.workflowDefinitions, workflow);
  }

  async listWorkflowRuns(
    orgId: string,
    workflowId?: string,
  ): Promise<E.WorkflowRun[]> {
    return this.data.workflowRuns
      .filter(
        (run) =>
          run.orgId === orgId &&
          (workflowId === undefined || run.workflowId === workflowId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getWorkflowRun(
    workflowRunId: string,
  ): Promise<E.WorkflowRun | undefined> {
    return this.data.workflowRuns.find((run) => run.id === workflowRunId);
  }

  async createWorkflowRun(run: E.WorkflowRun): Promise<E.WorkflowRun> {
    return append(this.data.workflowRuns, run);
  }

  async updateWorkflowRun(run: E.WorkflowRun): Promise<E.WorkflowRun> {
    return replaceById(this.data.workflowRuns, run);
  }

  async getRetentionPolicy(
    orgId: string,
  ): Promise<E.RetentionPolicy | undefined> {
    return this.data.retentionPolicies.find((policy) => policy.orgId === orgId);
  }

  async upsertRetentionPolicy(
    policy: E.RetentionPolicy,
  ): Promise<E.RetentionPolicy> {
    const index = this.data.retentionPolicies.findIndex(
      (item) => item.orgId === policy.orgId,
    );
    if (index >= 0) this.data.retentionPolicies[index] = policy;
    else this.data.retentionPolicies.push(policy);
    return policy;
  }

  async listQuotaBuckets(orgId: string): Promise<E.QuotaBucket[]> {
    return this.data.quotaBuckets
      .filter((bucket) => bucket.orgId === orgId)
      .sort((left, right) => left.metric.localeCompare(right.metric));
  }

  async createQuotaBucket(bucket: E.QuotaBucket): Promise<E.QuotaBucket> {
    return append(this.data.quotaBuckets, bucket);
  }

  async updateQuotaBucket(bucket: E.QuotaBucket): Promise<E.QuotaBucket> {
    return replaceById(this.data.quotaBuckets, bucket);
  }

  async deleteQuotaBucket(
    quotaBucketId: string,
  ): Promise<E.QuotaBucket | undefined> {
    return removeById(this.data.quotaBuckets, quotaBucketId);
  }

  async getBillingPlan(orgId: string): Promise<E.BillingPlan | undefined> {
    return this.data.billingPlans.find((plan) => plan.orgId === orgId);
  }

  async acquireBillingSyncLock(_orgId: string): Promise<void> {}

  async getBillingEventReceipt(
    orgId: string,
    provider: string,
    eventId: string,
  ): Promise<E.BillingEventReceipt | undefined> {
    return this.data.billingEventReceipts.find(
      (receipt) =>
        receipt.orgId === orgId &&
        receipt.provider === provider &&
        receipt.eventId === eventId,
    );
  }

  async createBillingEventReceipt(
    receipt: E.BillingEventReceipt,
  ): Promise<E.BillingEventReceipt> {
    const existing = await this.getBillingEventReceipt(
      receipt.orgId,
      receipt.provider,
      receipt.eventId,
    );
    if (existing !== undefined) return existing;
    this.data.billingEventReceipts.push(receipt);
    return receipt;
  }

  async upsertBillingPlan(plan: E.BillingPlan): Promise<E.BillingPlan> {
    const index = this.data.billingPlans.findIndex(
      (item) => item.orgId === plan.orgId,
    );
    if (index >= 0) this.data.billingPlans[index] = plan;
    else this.data.billingPlans.push(plan);
    return plan;
  }

  async listResourceGrants(orgId: string): Promise<Auth.ResourceGrant[]> {
    return listSeedResourceGrants(this.data, orgId);
  }

  async createResourceGrant(
    grant: Auth.ResourceGrant,
  ): Promise<Auth.ResourceGrant> {
    return append(this.data.grants, grant);
  }

  async deleteResourceGrant(
    grantId: string,
  ): Promise<Auth.ResourceGrant | undefined> {
    return removeById(this.data.grants, grantId);
  }

  async deleteResourceGrantsForPrincipal(
    orgId: string,
    principalType: Auth.PrincipalType,
    principalId: string,
  ): Promise<Auth.ResourceGrant[]> {
    const orgGrantIds = new Set(
      listSeedResourceGrants(this.data, orgId)
        .filter(
          (grant) =>
            grant.principalType === principalType &&
            grant.principalId === principalId,
        )
        .map((grant) => grant.id),
    );
    const deleted: Auth.ResourceGrant[] = [];
    for (let index = this.data.grants.length - 1; index >= 0; index -= 1) {
      const grant = this.data.grants[index];
      if (grant !== undefined && orgGrantIds.has(grant.id)) {
        deleted.push(...this.data.grants.splice(index, 1));
      }
    }
    return deleted.reverse();
  }
}
