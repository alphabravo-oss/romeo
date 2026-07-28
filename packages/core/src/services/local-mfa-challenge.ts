import { createHmac, timingSafeEqual } from "node:crypto";
import type { RomeoEnv } from "@romeo/config";

import { invalidLocalLogin } from "./local-auth-errors";

const challengeTtlMs = 5 * 60 * 1000;

export class LocalMfaChallengeCodec {
  constructor(private readonly env: RomeoEnv) {}

  create(input: { orgId: string; userId: string }): {
    expiresAt: string;
    token: string;
  } {
    const expiresAt = new Date(Date.now() + challengeTtlMs).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        orgId: input.orgId,
        userId: input.userId,
        exp: expiresAt,
      }),
    ).toString("base64url");
    return { expiresAt, token: `lmc_${payload}.${this.sign(payload)}` };
  }

  verify(token: string): { orgId: string; userId: string } {
    if (!token.startsWith("lmc_")) throw invalidLocalLogin();
    const [payload, signature] = token.slice("lmc_".length).split(".");
    if (payload === undefined || signature === undefined)
      throw invalidLocalLogin();
    if (!timingSafeStringEqual(signature, this.sign(payload)))
      throw invalidLocalLogin();
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown; orgId?: unknown; userId?: unknown; v?: unknown };
    if (
      parsed.v !== 1 ||
      typeof parsed.orgId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.exp !== "string" ||
      new Date(parsed.exp).getTime() <= Date.now()
    )
      throw invalidLocalLogin();
    return { orgId: parsed.orgId, userId: parsed.userId };
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.env.SESSION_SECRET)
      .update("romeo-local-mfa-challenge-v1", "utf8")
      .update(payload, "utf8")
      .digest("base64url");
  }
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
