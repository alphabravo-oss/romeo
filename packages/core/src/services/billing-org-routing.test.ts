import { describe, expect, it } from "vitest";

import { ApiError } from "../errors";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { BillingService } from "./billing-service";

describe("billing org routing", () => {
  it("maps webhook events by stored external customer id", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.upsertBillingPlan({
      id: "billing_plan_other",
      orgId: "org_other",
      code: "team",
      name: "Team",
      status: "active",
      source: "external",
      quotaTemplates: [
        { metric: "run.started", limit: 10, resetInterval: "monthly" },
      ],
      metadata: {},
      externalCustomerId: "cus_other",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    });
    const service = new BillingService(repository, {
      enabled: true,
      tenancyMode: "multi",
    });

    const result = await service.syncExternalEvent({
      subject: {
        id: "sa_billing",
        type: "service_account",
        orgId: "org_other",
        workspaceIds: [],
        groupIds: [],
        scopes: ["admin:write"],
        isAdmin: true,
      },
      event: {
        eventId: "evt_1",
        eventType: "invoice.paid",
        occurredAt: "2026-08-18T01:00:00.000Z",
        provider: "stripe",
        externalCustomerId: "cus_other",
      },
    });

    expect(result.plan.orgId).toBe("org_other");
  });

  it("hides billing when the feature is disabled", async () => {
    const service = new BillingService(new InMemoryRomeoRepository(), {
      enabled: false,
    });

    try {
      await service.current({
        id: "user_1",
        type: "user",
        orgId: "org_default",
        workspaceIds: [],
        groupIds: [],
        scopes: ["admin:read"],
        isAdmin: true,
      });
      throw new Error("expected billing_disabled");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("billing_disabled");
      expect((error as ApiError).status).toBe(404);
    }
  });
});
