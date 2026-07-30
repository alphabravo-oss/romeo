import type * as Auth from "@romeo/auth";

import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { append, removeById, replaceById } from "./collection-helpers";
import { listSeedResourceGrants } from "./resource-grants";
import { InMemoryRunRepository } from "./in-memory-run";

export abstract class InMemoryOperationsRepository extends InMemoryRunRepository {
  async listUsageEvents(orgId: string): Promise<E.UsageEvent[]> {
    return this.data.usageEvents
      .filter((event) => event.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createUsageEvent(event: E.UsageEvent): Promise<E.UsageEvent> {
    return append(this.data.usageEvents, event);
  }

  async updateUsageEvent(event: E.UsageEvent): Promise<E.UsageEvent> {
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
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

function payloadEquals(
  payload: Record<string, unknown>,
  expected: Record<string, string> | undefined,
): boolean {
  if (expected === undefined) return true;
  return Object.entries(expected).every(
    ([key, value]) => payload[key] === value,
  );
}

interface WorkerLeasePayload {
  attempt: number;
  claimedAt: string;
  expiresAt: string;
  leaseSeconds: number;
  renewedAt: string;
  workerId: string;
}

function applyWorkerLease(
  job: E.BackgroundJob,
  input: R.ClaimBackgroundJobInput,
  now: string,
): E.BackgroundJob {
  const previousLease = readWorkerLease(job.payload);
  return {
    ...job,
    status: "running",
    payload: {
      ...job.payload,
      workerLease: {
        attempt: (previousLease?.attempt ?? 0) + 1,
        claimedAt: now,
        expiresAt: leaseExpiresAt(now, input.leaseSeconds),
        leaseSeconds: input.leaseSeconds,
        renewedAt: now,
        workerId: input.workerId,
      },
    },
    updatedAt: now,
  };
}

function renewWorkerLease(
  job: E.BackgroundJob,
  input: R.RenewBackgroundJobLeaseInput,
  now: string,
  lease: WorkerLeasePayload,
): E.BackgroundJob {
  return {
    ...job,
    payload: {
      ...job.payload,
      workerLease: {
        ...lease,
        expiresAt: leaseExpiresAt(now, input.leaseSeconds),
        leaseSeconds: input.leaseSeconds,
        renewedAt: now,
      },
    },
    updatedAt: now,
  };
}

function readWorkerLease(
  payload: Record<string, unknown>,
): WorkerLeasePayload | undefined {
  const value = payload.workerLease;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const lease = value as Partial<WorkerLeasePayload>;
  if (
    typeof lease.workerId !== "string" ||
    typeof lease.claimedAt !== "string" ||
    typeof lease.renewedAt !== "string" ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.leaseSeconds !== "number" ||
    typeof lease.attempt !== "number"
  ) {
    return undefined;
  }
  return {
    attempt: lease.attempt,
    claimedAt: lease.claimedAt,
    expiresAt: lease.expiresAt,
    leaseSeconds: lease.leaseSeconds,
    renewedAt: lease.renewedAt,
    workerId: lease.workerId,
  };
}

function leaseExpiresAt(now: string, leaseSeconds: number): string {
  return new Date(
    Date.parse(now) + Math.max(1, leaseSeconds) * 1000,
  ).toISOString();
}
