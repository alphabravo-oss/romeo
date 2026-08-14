import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const CURSOR_FORMAT = "pc1";
const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 2_000;
const MAX_PAYLOAD_BYTES = 1_024;
const MAX_RESOURCE_LENGTH = 80;

export class InvalidPageCursorError extends Error {
  readonly code = "invalid_page_cursor";

  constructor() {
    super("Page cursor is invalid or expired.");
    this.name = "InvalidPageCursorError";
  }
}

export interface PageCursorCodecOptions {
  /** Current key first, followed by optional previous rotation keys. */
  secrets: readonly [string, ...string[]];
  resource: string;
  maxAgeSeconds?: number;
  now?: () => number;
}

export interface PageCursorContext {
  filter: unknown;
  sort: unknown;
}

export interface PageCursorEncodeInput<Position> extends PageCursorContext {
  position: Position;
}

interface CursorPayload {
  v: number;
  r: string;
  f: string;
  i: number;
  e?: number;
  p: unknown;
}

export interface PageCursorCodec {
  encode<Position>(input: PageCursorEncodeInput<Position>): string;
  decode<Position>(
    token: string,
    context: PageCursorContext,
    validatePosition: (value: unknown) => Position | undefined,
  ): Position;
}

/** Purpose-separates an existing application secret before cursor HMAC use. */
export function derivePageCursorSecret(
  sourceSecret: string,
  purpose: string,
): string {
  if (sourceSecret.length < 16 || !/^[a-z][a-z0-9_.:-]*$/u.test(purpose))
    throw new TypeError("Invalid page cursor secret derivation input.");
  return createHmac("sha256", sourceSecret)
    .update("romeo.page-cursor.secret.v1\0")
    .update(purpose)
    .digest("hex");
}

/**
 * Creates a purpose-bound, signed, opaque keyset cursor codec. The cursor is
 * tied to the resource plus the normalized filter/sort request, so it cannot
 * be replayed against a different tenant query shape. Authorization and
 * tenant identity must be included in `filter` by the calling service.
 */
export function createPageCursorCodec(
  options: PageCursorCodecOptions,
): PageCursorCodec {
  validateOptions(options);
  const now = options.now ?? Date.now;

  return {
    encode<Position>(input: PageCursorEncodeInput<Position>): string {
      const issuedAt = Math.floor(now() / 1_000);
      const payload: CursorPayload = {
        v: CURSOR_VERSION,
        r: options.resource,
        f: queryFingerprint(input),
        i: issuedAt,
        ...(options.maxAgeSeconds === undefined
          ? {}
          : { e: issuedAt + options.maxAgeSeconds }),
        p: input.position,
      };
      const encodedPayload = encodePayload(payload);
      const signature = sign(
        encodedPayload,
        options.secrets[0],
        options.resource,
      );
      const token = `${CURSOR_FORMAT}.${encodedPayload}.${signature}`;
      if (token.length > MAX_CURSOR_LENGTH) throw invalidCursor();
      return token;
    },

    decode<Position>(
      token: string,
      context: PageCursorContext,
      validatePosition: (value: unknown) => Position | undefined,
    ): Position {
      if (token.length < 1 || token.length > MAX_CURSOR_LENGTH)
        throw invalidCursor();
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== CURSOR_FORMAT)
        throw invalidCursor();
      const encodedPayload = parts[1];
      const encodedSignature = parts[2];
      if (encodedPayload === undefined || encodedSignature === undefined)
        throw invalidCursor();
      if (
        !options.secrets.some((secret) =>
          signaturesMatch(
            encodedSignature,
            sign(encodedPayload, secret, options.resource),
          ),
        )
      ) {
        throw invalidCursor();
      }
      const payload = decodePayload(encodedPayload);
      const currentSecond = Math.floor(now() / 1_000);
      if (
        payload.v !== CURSOR_VERSION ||
        payload.r !== options.resource ||
        payload.f !== queryFingerprint(context) ||
        !Number.isSafeInteger(payload.i) ||
        payload.i > currentSecond + 60 ||
        (payload.e !== undefined &&
          (!Number.isSafeInteger(payload.e) || payload.e < currentSecond))
      ) {
        throw invalidCursor();
      }
      const position = validatePosition(payload.p);
      if (position === undefined) throw invalidCursor();
      return position;
    },
  };
}

function validateOptions(options: PageCursorCodecOptions): void {
  if (
    options.resource.length < 1 ||
    options.resource.length > MAX_RESOURCE_LENGTH ||
    !/^[a-z][a-z0-9_.:-]*$/u.test(options.resource) ||
    options.secrets.some((secret) => secret.length < 32) ||
    (options.maxAgeSeconds !== undefined &&
      (!Number.isSafeInteger(options.maxAgeSeconds) ||
        options.maxAgeSeconds < 1))
  ) {
    throw new TypeError("Invalid page cursor codec configuration.");
  }
}

function queryFingerprint(context: PageCursorContext): string {
  return createHash("sha256")
    .update(canonicalJson({ filter: context.filter, sort: context.sort }))
    .digest("hex");
}

function encodePayload(payload: CursorPayload): string {
  let source: string;
  try {
    source = canonicalJson(payload);
  } catch {
    throw invalidCursor();
  }
  if (Buffer.byteLength(source, "utf8") > MAX_PAYLOAD_BYTES)
    throw invalidCursor();
  return Buffer.from(source, "utf8").toString("base64url");
}

function decodePayload(encoded: string): CursorPayload {
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > MAX_PAYLOAD_BYTES ||
      bytes.toString("base64url") !== encoded
    ) {
      throw invalidCursor();
    }
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value)) throw invalidCursor();
    return {
      v: value.v as number,
      r: value.r as string,
      f: value.f as string,
      i: value.i as number,
      ...(value.e === undefined ? {} : { e: value.e as number }),
      p: value.p,
    };
  } catch (caught) {
    if (caught instanceof InvalidPageCursorError) throw caught;
    throw invalidCursor();
  }
}

function sign(
  encodedPayload: string,
  secret: string,
  resource: string,
): string {
  return createHmac("sha256", secret)
    .update("romeo.page-cursor.v1\0")
    .update(resource)
    .update("\0")
    .update(encodedPayload)
    .digest("base64url");
}

function signaturesMatch(received: string, expected: string): boolean {
  try {
    const receivedBytes = Buffer.from(received, "base64url");
    const expectedBytes = Buffer.from(expected, "base64url");
    return (
      receivedBytes.byteLength === expectedBytes.byteLength &&
      receivedBytes.toString("base64url") === received &&
      timingSafeEqual(receivedBytes, expectedBytes)
    );
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidCursor();
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw invalidCursor();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCursor(): InvalidPageCursorError {
  return new InvalidPageCursorError();
}
