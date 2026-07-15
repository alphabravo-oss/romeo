import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import {
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";

import { ApiError } from "../errors";

const scryptPasswordHashPattern =
  /^scrypt\$v=1\$N=(\d+)\$r=(\d+)\$p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;
const argon2idPrefix = "$argon2id$";
const argon2idOptions = {
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function normalizeLocalAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertLocalPasswordPolicy(password: string): void {
  if (password.length < 12) {
    throw new ApiError(
      "local_password_too_short",
      "Local passwords must be at least 12 characters.",
      400,
    );
  }
  if (password.length > 256) {
    throw new ApiError(
      "local_password_too_long",
      "Local passwords must be at most 256 characters.",
      400,
    );
  }
}

export async function hashLocalPassword(password: string): Promise<string> {
  assertLocalPasswordPolicy(password);
  return argon2Hash(password, argon2idOptions);
}

export async function verifyLocalPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (encodedHash.startsWith(argon2idPrefix)) {
    try {
      return await argon2Verify(encodedHash, password);
    } catch {
      return false;
    }
  }
  const parsed = scryptPasswordHashPattern.exec(encodedHash);
  if (parsed === null) return false;
  const nValue = parsed[1];
  const rValue = parsed[2];
  const pValue = parsed[3];
  const saltValue = parsed[4];
  const hashValue = parsed[5];
  if (
    nValue === undefined ||
    rValue === undefined ||
    pValue === undefined ||
    saltValue === undefined ||
    hashValue === undefined
  )
    return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.byteLength,
    {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
      maxmem: 64 * 1024 * 1024,
    },
  );
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}

export function localPasswordNeedsRehash(encodedHash: string): boolean {
  return scryptPasswordHashPattern.test(encodedHash);
}

function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function burnLocalPasswordHash(password: string): Promise<void> {
  try {
    await hashLocalPassword(password.length === 0 ? "x".repeat(12) : password);
  } catch {
    await hashLocalPassword("x".repeat(12));
  }
}
