import { generateSecret, generateURI, verify } from "otplib";

export interface TotpEnrollmentSecret {
  otpauthUri: string;
  secret: string;
}

export function createTotpEnrollmentSecret(input: {
  email: string;
  issuer?: string;
}): TotpEnrollmentSecret {
  const issuer = input.issuer ?? "Romeo";
  const secret = generateSecret({ length: 20 });
  return {
    secret,
    otpauthUri: generateURI({
      strategy: "totp",
      issuer,
      label: input.email,
      secret,
      algorithm: "sha1",
      digits: 6,
      period: 30,
    }),
  };
}

/**
 * Verifies a TOTP code and returns the matched time-step, or undefined when
 * the code is invalid or not newer than `afterTimeStep` (replay protection).
 */
export async function verifyTotpCode(input: {
  afterTimeStep?: number;
  code: string;
  secret: string;
}): Promise<number | undefined> {
  if (!/^\d{6}$/u.test(input.code.trim())) return undefined;
  try {
    const result = await verify({
      strategy: "totp",
      secret: input.secret,
      token: input.code.trim(),
      algorithm: "sha1",
      digits: 6,
      period: 30,
      epochTolerance: 30,
      ...(input.afterTimeStep === undefined
        ? {}
        : { afterTimeStep: input.afterTimeStep }),
    });
    return result.valid && "timeStep" in result ? result.timeStep : undefined;
  } catch {
    // otplib rejects an afterTimeStep beyond the verification window (clock
    // moved backwards); no code can be accepted in that case.
    return undefined;
  }
}
