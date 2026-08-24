export interface RuntimeRolePosture extends Record<string, unknown> {
  bypassesRls: boolean;
  coordinator: boolean;
  inheritsPrivileges: boolean;
  superuser: boolean;
  tenantRuntime: boolean;
}

export interface RuntimeRolePostureValidatorOptions {
  now?: () => number;
  successTtlMs?: number;
}

export class RuntimeRolePostureValidator {
  private inFlight: Promise<void> | undefined;
  private validUntil = 0;
  private readonly now: () => number;
  private readonly successTtlMs: number;

  constructor(
    private readonly load: () => Promise<RuntimeRolePosture | undefined>,
    options: RuntimeRolePostureValidatorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.successTtlMs = Math.max(
      1_000,
      Math.min(options.successTtlMs ?? 15_000, 60_000),
    );
  }

  assertEligible(): Promise<void> {
    if (this.now() < this.validUntil) return Promise.resolve();
    if (this.inFlight !== undefined) return this.inFlight;
    const pending = this.validate().finally(() => {
      if (this.inFlight === pending) this.inFlight = undefined;
    });
    this.inFlight = pending;
    return pending;
  }

  invalidate(): void {
    this.validUntil = 0;
  }

  private async validate(): Promise<void> {
    const posture = await this.load();
    if (
      posture === undefined ||
      posture.bypassesRls ||
      posture.inheritsPrivileges ||
      posture.superuser
    ) {
      throw new Error("tenant_database_context_privileged_role_forbidden");
    }
    if (!posture.tenantRuntime || !posture.coordinator)
      throw new Error("tenant_database_context_role_required");
    this.validUntil = this.now() + this.successTtlMs;
  }
}
