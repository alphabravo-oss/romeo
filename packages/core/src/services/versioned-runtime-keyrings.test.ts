import { describe, expect, it } from "vitest";

import type { WebhookDelivery } from "../domain/webhooks";
import { WebhookSigningKeyring } from "./webhook-signing-keyring";

describe("versioned runtime keyrings", () => {
  it("writes active webhook signatures, emits a bounded previous signature, and reports removal posture", async () => {
    const keyring = new WebhookSigningKeyring({
      active: "new-webhook-signing-key-32-bytes",
      previous: "old-webhook-signing-key-32-bytes",
    });
    const signatures = await keyring.sign(
      "subscription_1",
      "1787486400",
      '{"event":"run.completed"}',
    );

    expect(signatures.active.signature).toMatch(/^v1=[a-f0-9]{64}$/u);
    expect(signatures.previous?.signature).toMatch(/^v1=[a-f0-9]{64}$/u);
    expect(signatures.previous?.version).not.toBe(signatures.active.version);
    const activeDelivery = delivery(signatures.active.version);
    const previousDelivery = delivery(signatures.previous?.version);
    expect(
      keyring.rotationPosture([activeDelivery, previousDelivery]),
    ).toMatchObject({ active: 1, previous: 1, safeToRemovePrevious: false });
    expect(keyring.rotationPosture([activeDelivery])).toMatchObject({
      active: 1,
      previous: 0,
      safeToRemovePrevious: true,
    });
  });
});

function delivery(signatureKeyVersion: string | undefined): WebhookDelivery {
  return {
    id: "delivery_1",
    orgId: "org_1",
    subscriptionId: "subscription_1",
    eventType: "run.completed",
    payload: {},
    status: "delivered",
    attemptCount: 1,
    ...(signatureKeyVersion === undefined ? {} : { signatureKeyVersion }),
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:01.000Z",
  };
}
