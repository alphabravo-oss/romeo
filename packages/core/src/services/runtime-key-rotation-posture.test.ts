import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "../api";
import type { WebhookDelivery } from "../domain/webhooks";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { RuntimeKeyRotationPostureService } from "./runtime-key-rotation-posture-service";
import { WebhookSigningKeyring } from "./webhook-signing-keyring";

const activeWebhookSecret = "active-webhook-census-key-material";
const previousWebhookSecret = "previous-webhook-census-key-material";
const unknownWebhookSecret = "unknown-webhook-census-key-material";

const admin = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_admins"],
  scopes: ["admin:read", "admin:write"],
  isAdmin: true,
  adminRole: "global_admin",
} satisfies AuthSubject;

describe("runtime key rotation posture", () => {
  it("counts all tenants so another tenant blocks removal without leaking tenant or secret data", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = postureEnv();
    await seedActiveUsage(repository, "org_default");
    await seedOtherTenantBlockingUsage(repository);

    const report = await new RuntimeKeyRotationPostureService(
      repository,
      env,
    ).report(admin);

    expect(report.status).toBe("attention_required");
    expect(report.webhookSigning.usage).toEqual({
      active: 1,
      corrupt: 1,
      legacyUnversioned: 1,
      previous: 1,
      total: 5,
      unknown: 1,
    });
    expect(report.webhookSigning.safeToRemovePrevious).toBe(false);
    expect(
      report.webhookSigning.blockers.map((blocker) => blocker.code),
    ).toEqual([
      "previous_key_usage_present",
      "legacy_unversioned_records_present",
      "unknown_key_version_records_present",
      "corrupt_records_present",
    ]);

    const serialized = JSON.stringify(report);
    for (const secret of [
      activeWebhookSecret,
      previousWebhookSecret,
      unknownWebhookSecret,
      "webhook_census_active",
      "CENSUS_PAYLOAD_SECRET",
      "CENSUS_CORRUPT_CIPHERTEXT_SECRET",
      "org_default",
      "org_other",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(report.redaction).toEqual({
      ciphertextReturned: false,
      deliveryIdsReturned: false,
      keyMaterialReturned: false,
      payloadsReturned: false,
      rawSignaturesReturned: false,
      secretValuesReturned: false,
    });
    expect((await repository.listAuditLogs("org_default")).at(0)).toMatchObject(
      {
        action: "admin.key_rotation.posture.read",
        resourceId: "platform",
        resourceType: "runtime_key_rotation",
        metadata: { aggregationScope: "all_organizations" },
      },
    );
  });

  it("reports zero authoritative records as safe before previous-key removal", async () => {
    const report = await new RuntimeKeyRotationPostureService(
      new InMemoryRomeoRepository(),
      postureEnv(),
    ).report(admin);

    expect(report).toMatchObject({
      status: "ready",
      webhookSigning: {
        removalStatus: "safe",
        safeToRemovePrevious: true,
        blockers: [],
        usage: { total: 0 },
      },
    });
  });

  it("requires both admin read scope and the global admin role", async () => {
    const service = new RuntimeKeyRotationPostureService(
      new InMemoryRomeoRepository(),
      postureEnv(),
    );
    await expect(service.report({ ...admin, scopes: [] })).rejects.toThrow(
      "Missing required scope: admin:read",
    );
    await expect(
      service.report({ ...admin, adminRole: "org_admin" }),
    ).rejects.toThrow("Global admin role is required");
    const { adminRole: _adminRole, ...nonAdmin } = admin;
    await expect(
      service.report({ ...nonAdmin, isAdmin: false }),
    ).rejects.toThrow("Global admin role is required");
  });

  it("exposes the platform report through an authenticated global-admin route", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { env: postureEnv() });
    const response = await api.request(
      "/api/v1/admin/runtime-key-rotation/posture",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      schema: "romeo.runtime-key-rotation-posture.v1",
      aggregationScope: "all_organizations",
      status: "ready",
    });

    const unauthenticated = createRomeoApi(new InMemoryRomeoRepository(), {
      env: postureEnv({ DEV_SEEDED_LOGIN: "false" }),
    });
    expect(
      (
        await unauthenticated.request(
          "/api/v1/admin/runtime-key-rotation/posture",
        )
      ).status,
    ).toBe(401);
  });
});

function postureEnv(overrides: Record<string, string> = {}) {
  return testEnv({
    WEBHOOK_SIGNING_KEY: activeWebhookSecret,
    WEBHOOK_SIGNING_KEY_PREVIOUS: previousWebhookSecret,
    ...overrides,
  });
}

async function seedActiveUsage(
  repository: InMemoryRomeoRepository,
  orgId: string,
): Promise<void> {
  const webhookKeyring = new WebhookSigningKeyring({
    active: activeWebhookSecret,
    previous: previousWebhookSecret,
  });
  await repository.createWebhookDelivery(
    webhookDelivery("active", orgId, webhookKeyring.activeVersion),
  );
}

async function seedOtherTenantBlockingUsage(
  repository: InMemoryRomeoRepository,
): Promise<void> {
  const orgId = "org_other";
  const previousKeyring = new WebhookSigningKeyring({
    active: previousWebhookSecret,
  });
  const unknownKeyring = new WebhookSigningKeyring({
    active: unknownWebhookSecret,
  });
  for (const [name, version] of [
    ["other_previous", previousKeyring.activeVersion],
    ["other_legacy", undefined],
    ["other_unknown", unknownKeyring.activeVersion],
    ["other_corrupt", "not-a-key-version"],
  ] as const) {
    await repository.createWebhookDelivery(
      webhookDelivery(name, orgId, version),
    );
  }
}

function webhookDelivery(
  name: string,
  orgId: string,
  signatureKeyVersion: string | undefined,
): WebhookDelivery {
  return {
    id: `webhook_census_${name}`,
    orgId,
    subscriptionId: `webhook_subscription_${orgId}`,
    eventType: "webhook.test",
    payload: { sentinel: "CENSUS_PAYLOAD_SECRET" },
    status: "delivered",
    attemptCount: 1,
    ...(signatureKeyVersion === undefined ? {} : { signatureKeyVersion }),
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}
