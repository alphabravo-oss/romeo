import { describe, expect, it } from "vitest";

import type { DelegatedOAuthTokenEnvelope } from "../domain/delegated-oauth";
import type { WebhookDelivery } from "../domain/webhooks";
import {
  delegatedOAuthTokenContext,
  DelegatedOAuthTokenVault,
} from "./delegated-oauth-token-vault";
import { WebhookSigningKeyring } from "./webhook-signing-keyring";

const context = delegatedOAuthTokenContext({
  connectorType: "github",
  id: "oauth_connection_1",
  orgId: "org_1",
  providerId: "github",
  userId: "user_1",
  workspaceId: "workspace_1",
});
const token = {
  accessToken: "access-token",
  obtainedAt: "2026-08-23T00:00:00.000Z",
  scopes: ["repo"],
  tokenType: "bearer" as const,
};

describe("versioned runtime keyrings", () => {
  it("reads old OAuth envelopes, writes the active version, and proves zero old-key usage", () => {
    const oldVault = new DelegatedOAuthTokenVault("o".repeat(32));
    const oldEnvelope = oldVault.encrypt(token, context);
    const rotating = new DelegatedOAuthTokenVault({
      active: "n".repeat(32),
      previous: "o".repeat(32),
    });

    expect(rotating.decrypt(oldEnvelope, context)).toEqual(token);
    expect(rotating.needsRewrap(oldEnvelope)).toBe(true);
    const newEnvelope = rotating.encrypt(token, context);
    expect(newEnvelope).toMatchObject({
      v: 3,
      keyVersion: rotating.activeKeyVersion,
    });
    expect(rotating.rotationPosture([oldEnvelope, newEnvelope])).toMatchObject({
      active: 1,
      previous: 1,
      safeToRemovePrevious: false,
    });
    expect(rotating.rotationPosture([newEnvelope])).toMatchObject({
      active: 1,
      previous: 0,
      safeToRemovePrevious: true,
    });
    expect(() =>
      new DelegatedOAuthTokenVault("n".repeat(32)).decrypt(
        oldEnvelope,
        context,
      ),
    ).toThrow(/keyring/u);
  });

  it("rewraps unversioned OAuth envelopes through the bounded previous key", () => {
    const oldVault = new DelegatedOAuthTokenVault("o".repeat(32));
    const versioned = oldVault.encrypt(token, context);
    const legacy = { ...versioned, v: 2 } as DelegatedOAuthTokenEnvelope;
    delete (legacy as { keyVersion?: string }).keyVersion;
    const rotating = new DelegatedOAuthTokenVault({
      active: "n".repeat(32),
      previous: "o".repeat(32),
    });

    expect(rotating.decrypt(legacy, context)).toEqual(token);
    expect(rotating.rotationPosture([legacy])).toMatchObject({
      legacyUnversioned: 1,
      safeToRemovePrevious: false,
    });
  });

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
