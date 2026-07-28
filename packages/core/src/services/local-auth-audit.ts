import { createHmac } from "node:crypto";
import type { RomeoEnv } from "@romeo/config";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { ensureSystemAuditActor } from "./system-audit-actor";

export class LocalAuthAudit {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
  ) {}

  async write(
    input: {
      action: string;
      actorId: string;
      metadata: Record<string, unknown>;
      orgId: string;
      outcome?: "failure" | "success";
      resourceId: string;
      resourceType: string;
    },
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome ?? "success",
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    });
  }

  async loginFailure(
    user: User,
    failureClass:
      | "credential_locked"
      | "invalid_mfa_code"
      | "invalid_password"
      | "mfa_factor_unavailable"
      | "user_disabled",
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.write({
      orgId: user.orgId,
      actorId: user.id,
      action: "local_auth.login.failure",
      resourceType: "user",
      resourceId: user.id,
      outcome: "failure",
      metadata: { providerId: "local", failureClass, ...metadata },
    });
  }

  async unknownLoginFailure(
    orgId: string,
    emailNormalized: string,
  ): Promise<void> {
    try {
      const actor = await ensureSystemAuditActor(this.repository, {
        kind: "local_auth",
        name: "Romeo system local authentication",
        orgId,
      });
      await this.write({
        orgId,
        actorId: actor.id,
        action: "local_auth.login.failure",
        resourceType: "auth_principal",
        resourceId: "unknown_local_principal",
        outcome: "failure",
        metadata: {
          providerId: "local",
          failureClass: "unknown_principal",
          identifierHash: this.identifierHash(emailNormalized),
          identifierHashAlgorithm: "hmac-sha256",
        },
      });
    } catch {
      // Unknown-principal responses remain indistinguishable when audit actor
      // bootstrap is unavailable.
    }
  }

  private identifierHash(emailNormalized: string): string {
    return createHmac(
      "sha256",
      this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY || this.env.SESSION_SECRET,
    )
      .update("romeo-local-auth-identifier-v1", "utf8")
      .update(emailNormalized, "utf8")
      .digest("hex");
  }
}
