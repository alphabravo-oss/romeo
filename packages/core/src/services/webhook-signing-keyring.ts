import { createHash } from "node:crypto";

import type { WebhookDelivery } from "../domain/webhooks";
import {
  accumulateRuntimeKeyUsage,
  classifyWebhookSigningKeyVersion,
  emptyRuntimeKeyUsageCounts,
  type RuntimeKeyUsageCounts,
} from "../domain/runtime-key-usage";
import { deriveWebhookSecret, signWebhookPayload } from "./webhook-signing";

interface SigningKey {
  secret: string;
  version: string;
}

export interface VersionedWebhookSignatures {
  active: { signature: string; version: string };
  previous?: { signature: string; version: string };
}

export class WebhookSigningKeyring {
  private readonly active: SigningKey;
  private readonly previous?: SigningKey;

  constructor(input: { active: string; previous?: string | undefined }) {
    this.active = signingKey(input.active);
    const previous = input.previous?.trim();
    if (previous !== undefined && previous.length > 0) {
      this.previous = signingKey(previous);
      if (this.previous.version === this.active.version)
        throw new Error(
          "Webhook active and previous signing keys must differ.",
        );
    }
  }

  get activeVersion(): string {
    return this.active.version;
  }

  get previousVersion(): string | undefined {
    return this.previous?.version;
  }

  async sign(
    subscriptionId: string,
    timestamp: string,
    body: string,
  ): Promise<VersionedWebhookSignatures> {
    const active = await signature(
      this.active,
      subscriptionId,
      timestamp,
      body,
    );
    const previous =
      this.previous === undefined
        ? undefined
        : await signature(this.previous, subscriptionId, timestamp, body);
    return { active, ...(previous === undefined ? {} : { previous }) };
  }

  rotationPosture(deliveries: WebhookDelivery[]): {
    active: number;
    corrupt: number;
    legacyUnversioned: number;
    previous: number;
    safeToRemovePrevious: boolean;
    unknown: number;
  } {
    const counts = emptyRuntimeKeyUsageCounts();
    for (const delivery of deliveries) {
      accumulateRuntimeKeyUsage(
        counts,
        classifyWebhookSigningKeyVersion(delivery.signatureKeyVersion, {
          activeVersion: this.active.version,
          ...(this.previous === undefined
            ? {}
            : { previousVersion: this.previous.version }),
        }),
      );
    }
    return this.rotationPostureFromUsage(counts);
  }

  rotationPostureFromUsage(counts: RuntimeKeyUsageCounts): {
    active: number;
    corrupt: number;
    legacyUnversioned: number;
    previous: number;
    safeToRemovePrevious: boolean;
    total: number;
    unknown: number;
  } {
    return {
      ...counts,
      safeToRemovePrevious:
        counts.previous === 0 &&
        counts.legacyUnversioned === 0 &&
        counts.unknown === 0 &&
        counts.corrupt === 0,
    };
  }
}

function signingKey(secret: string): SigningKey {
  const trimmed = secret.trim();
  if (trimmed.length < 16)
    throw new Error("Webhook signing keys must be at least 16 characters.");
  return {
    secret: trimmed,
    version: createHash("sha256")
      .update("romeo webhook signing key version v1", "utf8")
      .update(trimmed, "utf8")
      .digest("hex")
      .slice(0, 16),
  };
}

async function signature(
  key: SigningKey,
  subscriptionId: string,
  timestamp: string,
  body: string,
): Promise<{ signature: string; version: string }> {
  const secret = await deriveWebhookSecret(key.secret, subscriptionId);
  return {
    signature: await signWebhookPayload(secret, timestamp, body),
    version: key.version,
  };
}
