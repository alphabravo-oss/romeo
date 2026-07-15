import type {
  BillingEntitlementReconciliationResult,
  BillingLifecycleEnforcementResult,
} from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface BillingEntitlementReconciliationWorkerClient {
  admin: {
    reconcileBillingEntitlements(): Promise<BillingEntitlementReconciliationResult>;
  };
}

export interface BillingLifecycleEnforcementWorkerClient {
  admin: {
    enforceBillingLifecycle(): Promise<BillingLifecycleEnforcementResult>;
  };
}

export interface RunBillingEntitlementReconciliationWorkerInput {
  client: BillingEntitlementReconciliationWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxIterations?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunBillingLifecycleEnforcementWorkerInput {
  client: BillingLifecycleEnforcementWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxIterations?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function runBillingEntitlementReconciliationWorker(
  input: RunBillingEntitlementReconciliationWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const result = await input.client.admin.reconcileBillingEntitlements();
    writeReconciliationResult(input.io, iteration, result);

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

export async function runBillingLifecycleEnforcementWorker(
  input: RunBillingLifecycleEnforcementWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const result = await input.client.admin.enforceBillingLifecycle();
    writeLifecycleEnforcementResult(input.io, iteration, result);

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

function writeReconciliationResult(
  io: CliIo,
  iteration: number,
  result: BillingEntitlementReconciliationResult,
): void {
  writeJson(io, {
    iteration,
    createdQuotaCount: result.actions.createdQuotaIds.length,
    updatedQuotaCount: result.actions.updatedQuotaIds.length,
    unchangedQuotaCount: result.actions.unchangedQuotaIds.length,
    beforeStatus: result.before.status,
    afterStatus: result.after.status,
    beforeWarnings: result.before.warnings,
    afterWarnings: result.after.warnings,
    result,
  });
}

function writeLifecycleEnforcementResult(
  io: CliIo,
  iteration: number,
  result: BillingLifecycleEnforcementResult,
): void {
  writeJson(io, {
    iteration,
    statusChangedCount: result.action.statusChanged ? 1 : 0,
    action: result.action.type,
    beforeStatus: result.before.status,
    afterStatus: result.after.status,
    beforeWarnings: result.before.warnings,
    afterWarnings: result.after.warnings,
    result,
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
