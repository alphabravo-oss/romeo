import { createHash } from "node:crypto";

import { ApiError } from "../errors";
import type {
  QuotaCoordinator,
  QuotaCoordinationStatus,
  QuotaReservationBucket,
  QuotaReservationInput,
  QuotaReservationResult,
} from "./quota-coordination";
import { ValkeyRespClient, type RespValue } from "./valkey-resp-client";

const reserveScript = `
local quantity = tonumber(ARGV[1])
for index = 1, #KEYS do
  local base = 2 + ((index - 1) * 4)
  local bucket_id = ARGV[base]
  local seed = tonumber(ARGV[base + 1])
  local limit = tonumber(ARGV[base + 2])
  local current = redis.call("GET", KEYS[index])
  if current == false then
    current = seed
  else
    current = tonumber(current)
  end
  if current + quantity > limit then
    return {0, bucket_id, current, limit}
  end
end

local result = {1}
for index = 1, #KEYS do
  local base = 2 + ((index - 1) * 4)
  local bucket_id = ARGV[base]
  local seed = tonumber(ARGV[base + 1])
  local ttl_ms = tonumber(ARGV[base + 3])
  local current = redis.call("GET", KEYS[index])
  if current == false then
    current = seed
  else
    current = tonumber(current)
  end
  local next_value = current + quantity
  if ttl_ms > 0 then
    redis.call("SET", KEYS[index], next_value, "PX", ttl_ms)
  else
    redis.call("SET", KEYS[index], next_value)
  end
  table.insert(result, bucket_id)
  table.insert(result, next_value)
end
return result
`;

export class ValkeyQuotaCoordinator implements QuotaCoordinator {
  private readonly client: ValkeyRespClient;

  constructor(
    private readonly options: {
      keyPrefix: string;
      timeoutMs: number;
      url: string;
    },
  ) {
    this.client = new ValkeyRespClient({
      timeoutMs: options.timeoutMs,
      url: options.url,
    });
  }

  async reserve(
    input: QuotaReservationInput,
  ): Promise<QuotaReservationResult> {
    if (input.buckets.length === 0) {
      return { allowed: true, reservations: [] };
    }
    this.assertConfigured();
    try {
      const keys = input.buckets.map((bucket) => this.keyFor(bucket));
      const args = [
        "EVAL",
        reserveScript,
        String(keys.length),
        ...keys,
        String(input.quantity),
        ...input.buckets.flatMap((bucket) => [
          bucket.id,
          String(bucket.used),
          String(bucket.limit),
          String(ttlMsFor(bucket)),
        ]),
      ];
      const response = await this.client.command(args);
      return parseReservationResult(response);
    } catch (error) {
      throw quotaCoordinationUnavailable(error);
    }
  }

  async status(): Promise<QuotaCoordinationStatus> {
    if (!this.configured) {
      return {
        driver: "valkey",
        enabled: true,
        configured: false,
        healthy: false,
        keyPrefix: this.options.keyPrefix,
        checkedAt: new Date().toISOString(),
        details: {
          failClosed: true,
          statusCode: "unconfigured",
        },
      };
    }

    try {
      const response = await this.client.command(["PING"]);
      return {
        driver: "valkey",
        enabled: true,
        configured: true,
        healthy: response === "PONG",
        keyPrefix: this.options.keyPrefix,
        checkedAt: new Date().toISOString(),
        details: {
          failClosed: true,
          statusCode: response === "PONG" ? "healthy" : "unreachable",
        },
      };
    } catch {
      return {
        driver: "valkey",
        enabled: true,
        configured: true,
        healthy: false,
        keyPrefix: this.options.keyPrefix,
        checkedAt: new Date().toISOString(),
        details: {
          failClosed: true,
          statusCode: "unreachable",
        },
      };
    }
  }

  async syncBucket(bucket: QuotaReservationBucket): Promise<void> {
    this.assertConfigured();
    try {
      const ttlMs = ttlMsFor(bucket);
      const command =
        ttlMs > 0
          ? ["SET", this.keyFor(bucket), String(bucket.used), "PX", String(ttlMs)]
          : ["SET", this.keyFor(bucket), String(bucket.used)];
      await this.client.command(command);
    } catch (error) {
      throw quotaCoordinationUnavailable(error);
    }
  }

  async deleteBucket(bucket: QuotaReservationBucket): Promise<void> {
    this.assertConfigured();
    try {
      await this.client.command(["DEL", this.keyFor(bucket)]);
    } catch (error) {
      throw quotaCoordinationUnavailable(error);
    }
  }

  private get configured(): boolean {
    return this.options.url.trim().length > 0;
  }

  private assertConfigured(): void {
    if (this.configured) return;
    throw quotaCoordinationUnavailable(new Error("valkey_url_missing"));
  }

  private keyFor(bucket: QuotaReservationBucket): string {
    const reset = bucket.resetAt ?? "none";
    return [
      this.options.keyPrefix,
      "org",
      hashKeyPart(bucket.orgId),
      "bucket",
      hashKeyPart(`${bucket.id}:${reset}`),
      "metric",
      bucket.metric,
    ].join(":");
  }
}

function parseReservationResult(response: RespValue): QuotaReservationResult {
  if (!Array.isArray(response)) throw new Error("quota_reservation_invalid");
  const allowed = Number(response[0]) === 1;
  if (!allowed) {
    const bucketId = String(response[1] ?? "");
    return {
      allowed: false,
      bucketId,
      used: Number(response[2] ?? 0),
      limit: Number(response[3] ?? 0),
    };
  }

  const reservations: Array<{ bucketId: string; used: number }> = [];
  for (let index = 1; index < response.length; index += 2) {
    const bucketId = response[index];
    const used = response[index + 1];
    if (typeof bucketId !== "string") {
      throw new Error("quota_reservation_bucket_invalid");
    }
    reservations.push({ bucketId, used: Number(used ?? 0) });
  }
  return { allowed: true, reservations };
}

function ttlMsFor(bucket: QuotaReservationBucket): number {
  if (bucket.resetAt === undefined) return 30 * 24 * 60 * 60 * 1_000;
  const resetAt = new Date(bucket.resetAt).getTime();
  if (!Number.isFinite(resetAt)) return 30 * 24 * 60 * 60 * 1_000;
  const withSkew = resetAt - Date.now() + 60_000;
  return Math.max(60_000, withSkew);
}

function hashKeyPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function quotaCoordinationUnavailable(error: unknown): ApiError {
  const reason =
    error instanceof Error ? error.message : "quota_coordination_unavailable";
  return new ApiError(
    "quota_coordination_unavailable",
    "Quota coordination is unavailable.",
    503,
    { driver: "valkey", reason },
  );
}
