import { seededSubject } from "@romeo/auth";
import { generate } from "otplib";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import {
  maxConsecutiveLocalMfaFailures,
  maxLocalMfaChallengeAttempts,
} from "./local-auth-attempts";
import { LocalAuthService } from "./local-auth-service";
import { SessionService } from "./session-service";

const email = "admin@romeo.local";
const password = "local-admin-password-123";

async function setup() {
  const repository = new InMemoryRomeoRepository();
  const auth = new LocalAuthService(
    repository,
    new SessionService(repository),
    testEnv({
      DEV_SEEDED_LOGIN: "false",
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "prod-local-auth-secret-key-32-bytes",
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
    }),
  );
  await auth.setOwnPassword({ subject: seededSubject, newPassword: password });
  const enrollment = await auth.startTotpEnrollment({ subject: seededSubject });
  const totpAt = (offsetSeconds: number) =>
    generate({
      strategy: "totp",
      secret: enrollment.secret,
      algorithm: "sha1",
      digits: 6,
      period: 30,
      epoch: Math.floor(Date.now() / 1000) + offsetSeconds,
    });
  await auth.confirmTotpEnrollment({
    subject: seededSubject,
    factorId: enrollment.factor.id,
    code: await totpAt(-30),
  });
  const valid = new Set(
    await Promise.all([-30, 0, 30].map((offset) => totpAt(offset))),
  );
  let badCode = 0;
  while (valid.has(String(badCode).padStart(6, "0"))) badCode += 1;
  const challenge = async () => {
    const result = await auth.login({ email, password });
    if (result.status !== "mfa_required")
      throw new Error("Expected an MFA challenge.");
    return result.challengeToken;
  };
  return {
    auth,
    badCode: String(badCode).padStart(6, "0"),
    challenge,
    repository,
    totpAt,
  };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
  return "resolved";
}

describe("local MFA attempt hardening", () => {
  it("invalidates a challenge after a bounded number of attempts", async () => {
    const { auth, badCode, challenge, totpAt } = await setup();
    const challengeToken = await challenge();
    for (let index = 0; index < maxLocalMfaChallengeAttempts; index += 1) {
      expect(
        await errorCode(auth.verifyMfaLogin({ challengeToken, code: badCode })),
      ).toBe("local_mfa_code_invalid");
    }
    expect(
      await errorCode(
        auth.verifyMfaLogin({ challengeToken, code: await totpAt(0) }),
      ),
    ).toBe("local_login_invalid");
  });

  it("locks the credential after consecutive MFA failures across challenges", async () => {
    const { auth, badCode, challenge, repository, totpAt } = await setup();
    let failures = 0;
    let pendingChallenge = await challenge();
    while (failures < maxConsecutiveLocalMfaFailures) {
      if (failures % maxLocalMfaChallengeAttempts === 0)
        pendingChallenge = await challenge();
      expect(
        await errorCode(
          auth.verifyMfaLogin({
            challengeToken: pendingChallenge,
            code: badCode,
          }),
        ),
      ).toBe("local_mfa_code_invalid");
      failures += 1;
    }

    const credential =
      await repository.getLocalPasswordCredentialByUserId("user_dev_admin");
    expect(credential?.mfaFailedAttemptCount).toBe(
      maxConsecutiveLocalMfaFailures,
    );
    expect(credential?.lockedUntil).toBeDefined();
    // Neither a fresh password login nor an outstanding challenge can be used
    // while the credential is locked, even with a valid code.
    expect(await errorCode(auth.login({ email, password }))).toBe(
      "local_login_invalid",
    );
    expect(
      await errorCode(
        auth.verifyMfaLogin({
          challengeToken: pendingChallenge,
          code: await totpAt(0),
        }),
      ),
    ).toBe("local_login_invalid");
  });

  it("does not reset the MFA failure budget on password success but does on MFA success", async () => {
    const { auth, badCode, challenge, repository, totpAt } = await setup();
    for (let index = 0; index < 3; index += 1) {
      await errorCode(
        auth.verifyMfaLogin({
          challengeToken: await challenge(),
          code: badCode,
        }),
      );
    }
    expect(
      (await repository.getLocalPasswordCredentialByUserId("user_dev_admin"))
        ?.mfaFailedAttemptCount,
    ).toBe(3);
    const session = await auth.verifyMfaLogin({
      challengeToken: await challenge(),
      code: await totpAt(0),
    });
    expect(session.token).toMatch(/^rms_/u);
    expect(
      (await repository.getLocalPasswordCredentialByUserId("user_dev_admin"))
        ?.mfaFailedAttemptCount ?? 0,
    ).toBe(0);
  });

  it("rejects reuse of an accepted TOTP time-step and keeps recovery codes working", async () => {
    const { auth, challenge, totpAt } = await setup();
    const code = await totpAt(0);
    await auth.verifyMfaLogin({ challengeToken: await challenge(), code });
    expect(
      await errorCode(
        auth.verifyMfaLogin({ challengeToken: await challenge(), code }),
      ),
    ).toBe("local_mfa_code_invalid");
    expect(
      await errorCode(
        auth.verifyMfaLogin({
          challengeToken: await challenge(),
          code: await totpAt(-30),
        }),
      ),
    ).toBe("local_mfa_code_invalid");
    expect(
      await errorCode(auth.login({ email, password, totpCode: code })),
    ).toBe("local_mfa_code_invalid");

    const recovery = await auth.generateRecoveryCodes({
      subject: seededSubject,
      totpCode: await totpAt(30),
    });
    const recovered = await auth.verifyMfaLogin({
      challengeToken: await challenge(),
      recoveryCode: recovery.codes[0]!,
    });
    expect(recovered.token).toMatch(/^rms_/u);
  });
});
