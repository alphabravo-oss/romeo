import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { ApiError } from "../errors";

export const workerBrokerAudiences = [
  "tool_dispatch",
  "browser_automation",
  "knowledge_extraction",
] as const;

export type WorkerBrokerAudience = (typeof workerBrokerAudiences)[number];

export interface WorkerBrokerClaimTokenPayload {
  attempt: number;
  audience: WorkerBrokerAudience;
  expiresAt: string;
  fence: number;
  orgId: string;
  leaseToken?: string;
  workerId: string;
  workId: string;
  version: 1;
}

export interface WorkerBrokerCredential {
  current: string;
  previous?: string;
}

const tokenPrefix = "romeo_worker_claim_v1";

export class WorkerBrokerTokenCodec {
  private readonly currentKey: Buffer;
  private readonly keys: Buffer[];

  constructor(private readonly credential: WorkerBrokerCredential) {
    assertCredential(credential.current, "current");
    if (credential.previous !== undefined) {
      assertCredential(credential.previous, "previous");
      if (secretEquals(credential.current, credential.previous)) {
        throw new Error("worker_broker_credentials_must_be_independent");
      }
    }
    this.currentKey = deriveKey(credential.current);
    this.keys = [
      this.currentKey,
      ...(credential.previous === undefined
        ? []
        : [deriveKey(credential.previous)]),
    ];
  }

  authenticateBearer(authorization: string | undefined): void {
    const token = bearerToken(authorization);
    const valid = [this.credential.current, this.credential.previous]
      .filter((candidate): candidate is string => candidate !== undefined)
      .map((candidate) => secretEquals(token, candidate))
      .some(Boolean);
    if (!valid) throw brokerAuthenticationError();
  }

  issue(payload: WorkerBrokerClaimTokenPayload): string {
    assertClaimPayload(payload);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.currentKey,
      initializationVector,
    );
    cipher.setAAD(Buffer.from(tokenPrefix));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return [
      tokenPrefix,
      initializationVector.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  verify(
    token: string,
    expected: { audience: WorkerBrokerAudience; workerId: string },
    now = new Date(),
  ): WorkerBrokerClaimTokenPayload {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== tokenPrefix)
      throw invalidClaimToken();
    const [, encodedIv, encodedCiphertext, encodedTag] = parts;
    if (
      encodedIv === undefined ||
      encodedCiphertext === undefined ||
      encodedTag === undefined
    ) {
      throw invalidClaimToken();
    }
    let decoded: unknown;
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(encodedIv, "base64url"),
        );
        decipher.setAAD(Buffer.from(tokenPrefix));
        decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
        decoded = JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(encodedCiphertext, "base64url")),
            decipher.final(),
          ]).toString("utf8"),
        );
        break;
      } catch {
        // Try the previous rotation key without revealing which key matched.
      }
    }
    if (!isClaimPayload(decoded)) throw invalidClaimToken();
    if (
      decoded.audience !== expected.audience ||
      decoded.workerId !== expected.workerId
    ) {
      throw new ApiError(
        "worker_broker_claim_scope_mismatch",
        "The worker claim is not valid for this audience and worker.",
        403,
      );
    }
    if (Date.parse(decoded.expiresAt) <= now.getTime()) {
      throw new ApiError(
        "worker_broker_claim_expired",
        "The worker claim has expired.",
        409,
      );
    }
    return decoded;
  }
}

function bearerToken(authorization: string | undefined): string {
  if (authorization?.startsWith("Bearer ") !== true) return "";
  return authorization.slice("Bearer ".length).trim();
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256")
    .update("romeo-worker-broker-claim-v1\0")
    .update(secret)
    .digest();
}

function secretEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function assertCredential(value: string, label: string): void {
  if (value.length < 32)
    throw new Error(`worker_broker_${label}_credential_too_short`);
}

function assertClaimPayload(payload: WorkerBrokerClaimTokenPayload): void {
  if (!isClaimPayload(payload)) throw new Error("worker_broker_claim_invalid");
}

function isClaimPayload(
  value: unknown,
): value is WorkerBrokerClaimTokenPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const payload = value as Partial<WorkerBrokerClaimTokenPayload>;
  return (
    payload.version === 1 &&
    workerBrokerAudiences.some((audience) => audience === payload.audience) &&
    typeof payload.orgId === "string" &&
    payload.orgId.length > 0 &&
    typeof payload.workId === "string" &&
    payload.workId.length > 0 &&
    typeof payload.workerId === "string" &&
    payload.workerId.length > 0 &&
    typeof payload.expiresAt === "string" &&
    Number.isFinite(Date.parse(payload.expiresAt)) &&
    typeof payload.attempt === "number" &&
    Number.isInteger(payload.attempt) &&
    payload.attempt > 0 &&
    typeof payload.fence === "number" &&
    Number.isInteger(payload.fence) &&
    payload.fence > 0 &&
    (payload.leaseToken === undefined ||
      (typeof payload.leaseToken === "string" && payload.leaseToken.length > 0))
  );
}

function brokerAuthenticationError(): ApiError {
  return new ApiError(
    "worker_broker_authentication_failed",
    "Worker broker authentication failed.",
    401,
  );
}

function invalidClaimToken(): ApiError {
  return new ApiError(
    "worker_broker_claim_invalid",
    "The worker claim is invalid.",
    401,
  );
}
