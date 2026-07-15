import type { QuotaBucket } from "../domain/entities";

export type QuotaCoordinationDriver = "disabled" | "valkey";

export interface QuotaReservationBucket {
  id: string;
  orgId: string;
  scopeType: QuotaBucket["scopeType"];
  scopeId: string;
  metric: QuotaBucket["metric"];
  limit: number;
  used: number;
  resetInterval: QuotaBucket["resetInterval"];
  resetAt?: string;
}

export interface QuotaReservationInput {
  buckets: QuotaReservationBucket[];
  quantity: number;
}

export type QuotaReservationResult =
  | {
      allowed: true;
      reservations: Array<{ bucketId: string; used: number }>;
    }
  | {
      allowed: false;
      bucketId: string;
      used: number;
      limit: number;
    };

export interface QuotaCoordinationStatus {
  driver: QuotaCoordinationDriver;
  enabled: boolean;
  configured: boolean;
  healthy: boolean | null;
  keyPrefix: string;
  checkedAt: string;
  details: {
    failClosed: boolean;
    statusCode:
      | "disabled"
      | "healthy"
      | "unconfigured"
      | "unreachable";
  };
}

export interface QuotaCoordinator {
  reserve(input: QuotaReservationInput): Promise<QuotaReservationResult>;
  status(): Promise<QuotaCoordinationStatus>;
  syncBucket(bucket: QuotaReservationBucket): Promise<void>;
  deleteBucket(bucket: QuotaReservationBucket): Promise<void>;
}

export function createDisabledQuotaCoordinator(
  keyPrefix = "romeo:quota:v1",
): QuotaCoordinator {
  return {
    async reserve(input) {
      return {
        allowed: true,
        reservations: input.buckets.map((bucket) => ({
          bucketId: bucket.id,
          used: bucket.used + input.quantity,
        })),
      };
    },
    async status() {
      return {
        driver: "disabled",
        enabled: false,
        configured: false,
        healthy: null,
        keyPrefix,
        checkedAt: new Date().toISOString(),
        details: {
          failClosed: false,
          statusCode: "disabled",
        },
      };
    },
    async syncBucket() {},
    async deleteBucket() {},
  };
}

export function toQuotaReservationBucket(
  bucket: QuotaBucket,
): QuotaReservationBucket {
  const reservationBucket: QuotaReservationBucket = {
    id: bucket.id,
    orgId: bucket.orgId,
    scopeType: bucket.scopeType,
    scopeId: bucket.scopeId,
    metric: bucket.metric,
    limit: bucket.limit,
    used: bucket.used,
    resetInterval: bucket.resetInterval,
  };
  if (bucket.resetAt !== undefined) reservationBucket.resetAt = bucket.resetAt;
  return reservationBucket;
}
