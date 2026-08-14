import { describe, expect, it } from "vitest";

import { PgAuditRepository } from "./audit-repository";
import type { RomeoDatabase } from "./client";

describe("PgAuditRepository audit taxonomy boundary", () => {
  it("rejects invalid direct writes before issuing a database query", async () => {
    const repository = new PgAuditRepository({} as RomeoDatabase);
    const privateSentinel = "PRIVATE_POSTGRES_AUDIT_SENTINEL";
    for (const input of [
      { action: "unregistered.audit.action", metadata: {} },
      {
        action: "model.pricing.update",
        metadata: { prompt: privateSentinel },
      },
    ]) {
      const write = repository.createAuditLog({
        id: "audit_postgres_boundary",
        orgId: "org_default",
        actorId: "user_dev_admin",
        action: input.action,
        resourceType: "model",
        resourceId: "model_audit_taxonomy",
        outcome: "success",
        metadata: input.metadata,
        createdAt: "2026-08-14T12:00:00.000Z",
      });
      await expect(write).rejects.toThrow(TypeError);
      try {
        await write;
      } catch (error) {
        expect(String(error)).not.toContain(privateSentinel);
        expect(String(error)).not.toContain(input.action);
      }
    }
  });
});
