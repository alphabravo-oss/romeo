import type { RomeoEnv } from "@romeo/config";

import { ApiError } from "../errors";
import { ValkeyGlideClient, type ValkeyValue } from "./valkey-glide-client";

export interface LdapLoginAttemptStore {
  clear(key: string): Promise<void>;
  isLocked(key: string): Promise<boolean>;
  recordFailure(key: string): Promise<boolean>;
}

const recordFailureScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if count >= tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return count
`;

const processAttempts = new Map<string, { count: number; expiresAt: number }>();

export function createLdapLoginAttemptStore(
  env: RomeoEnv,
  options: { lockoutMs: number; maxFailedAttempts: number },
): LdapLoginAttemptStore {
  return env.HTTP_RATE_LIMIT_DRIVER === "valkey"
    ? new ValkeyLdapLoginAttemptStore(env, options)
    : new MemoryLdapLoginAttemptStore(options);
}

export class MemoryLdapLoginAttemptStore implements LdapLoginAttemptStore {
  constructor(
    private readonly options: {
      lockoutMs: number;
      maxFailedAttempts: number;
    },
    private readonly attempts = processAttempts,
  ) {}

  async isLocked(key: string): Promise<boolean> {
    const current = this.current(key);
    return (
      current !== undefined && current.count >= this.options.maxFailedAttempts
    );
  }

  async recordFailure(key: string): Promise<boolean> {
    const current = this.current(key);
    const count = (current?.count ?? 0) + 1;
    this.attempts.set(key, {
      count,
      expiresAt: Date.now() + this.options.lockoutMs,
    });
    this.prune();
    return count >= this.options.maxFailedAttempts;
  }

  async clear(key: string): Promise<void> {
    this.attempts.delete(key);
  }

  private current(key: string) {
    const current = this.attempts.get(key);
    if (current !== undefined && current.expiresAt <= Date.now()) {
      this.attempts.delete(key);
      return undefined;
    }
    return current;
  }

  private prune(): void {
    if (this.attempts.size <= 5_000) return;
    const now = Date.now();
    for (const [key, value] of this.attempts) {
      if (value.expiresAt <= now) this.attempts.delete(key);
    }
    while (this.attempts.size > 5_000) {
      const key = this.attempts.keys().next().value;
      if (key === undefined) break;
      this.attempts.delete(key);
    }
  }
}

class ValkeyLdapLoginAttemptStore implements LdapLoginAttemptStore {
  private readonly client: ValkeyGlideClient;

  constructor(
    env: RomeoEnv,
    private readonly options: {
      lockoutMs: number;
      maxFailedAttempts: number;
    },
  ) {
    this.client = new ValkeyGlideClient({
      timeoutMs: env.QUOTA_COORDINATION_TIMEOUT_MS,
      url: env.VALKEY_URL,
    });
  }

  async isLocked(key: string): Promise<boolean> {
    const value = await this.command(["GET", this.key(key)]);
    return numeric(value) >= this.options.maxFailedAttempts;
  }

  async recordFailure(key: string): Promise<boolean> {
    const value = await this.command([
      "EVAL",
      recordFailureScript,
      "1",
      this.key(key),
      String(this.options.maxFailedAttempts),
      String(this.options.lockoutMs),
    ]);
    return numeric(value) >= this.options.maxFailedAttempts;
  }

  async clear(key: string): Promise<void> {
    await this.command(["DEL", this.key(key)]);
  }

  private key(key: string): string {
    return `romeo:auth:ldap-attempt:${key}`;
  }

  private async command(args: string[]): Promise<ValkeyValue> {
    try {
      return await this.client.command(args);
    } catch {
      throw new ApiError(
        "ldap_lockout_unavailable",
        "LDAP authentication is temporarily unavailable.",
        503,
      );
    }
  }
}

function numeric(value: ValkeyValue): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed))
    throw new ApiError(
      "ldap_lockout_unavailable",
      "LDAP authentication is temporarily unavailable.",
      503,
    );
  return parsed;
}
