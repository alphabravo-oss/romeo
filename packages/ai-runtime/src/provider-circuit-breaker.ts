export interface ProviderCircuitBreakerPolicy {
  failureThreshold: number;
  cooldownMs: number;
}

export interface ProviderCircuitBreakerSnapshot {
  consecutiveFailures: number;
  state: "closed" | "half_open" | "open";
}

type CircuitRecord = ProviderCircuitBreakerSnapshot & { openedAtMs?: number };

export class ProviderCircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();

  constructor(
    private readonly policy: ProviderCircuitBreakerPolicy = {
      failureThreshold: 5,
      cooldownMs: 60_000,
    },
  ) {}

  beforeAttempt(providerId: string): ProviderCircuitBreakerSnapshot {
    const record = this.records.get(providerId);
    if (record === undefined) return closedCircuit();
    if (record.state !== "open") return snapshot(record);
    if (
      this.policy.cooldownMs > 0 &&
      record.openedAtMs !== undefined &&
      Date.now() - record.openedAtMs < this.policy.cooldownMs
    ) {
      return snapshot(record);
    }
    const halfOpen: CircuitRecord = {
      state: "half_open",
      consecutiveFailures: record.consecutiveFailures,
    };
    this.records.set(providerId, halfOpen);
    return snapshot(halfOpen);
  }

  recordSuccess(providerId: string): ProviderCircuitBreakerSnapshot {
    const next = closedCircuit();
    this.records.set(providerId, next);
    return snapshot(next);
  }

  snapshot(providerId: string): ProviderCircuitBreakerSnapshot {
    return snapshot(this.records.get(providerId) ?? closedCircuit());
  }

  recordFailure(providerId: string): ProviderCircuitBreakerSnapshot {
    if (this.policy.failureThreshold <= 0) return closedCircuit();
    const current = this.records.get(providerId) ?? closedCircuit();
    const consecutiveFailures =
      current.state === "half_open"
        ? this.policy.failureThreshold
        : current.consecutiveFailures + 1;
    const state =
      consecutiveFailures >= this.policy.failureThreshold ? "open" : "closed";
    const next: CircuitRecord = {
      state,
      consecutiveFailures,
      ...(state === "open" ? { openedAtMs: Date.now() } : {}),
    };
    this.records.set(providerId, next);
    return snapshot(next);
  }
}

function closedCircuit(): CircuitRecord {
  return { state: "closed", consecutiveFailures: 0 };
}

function snapshot(record: CircuitRecord): ProviderCircuitBreakerSnapshot {
  return {
    state: record.state,
    consecutiveFailures: record.consecutiveFailures,
  };
}
