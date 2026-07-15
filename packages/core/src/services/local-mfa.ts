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

export async function verifyTotpCode(input: {
  code: string;
  secret: string;
}): Promise<boolean> {
  if (!/^\d{6}$/u.test(input.code.trim())) return false;
  const result = await verify({
    strategy: "totp",
    secret: input.secret,
    token: input.code.trim(),
    algorithm: "sha1",
    digits: 6,
    period: 30,
    epochTolerance: 30,
  });
  return result.valid === true;
}
