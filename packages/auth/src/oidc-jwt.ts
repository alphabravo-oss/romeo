import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";

export interface OidcJwtVerifierConfig {
  audience: string;
  clockToleranceSeconds?: number;
  issuer: string;
  jwks: JsonWebKey[];
  now?: Date;
}

export class OidcJwtVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcJwtVerificationError";
  }
}

export async function verifyOidcJwt(
  token: string,
  config: OidcJwtVerifierConfig,
): Promise<Record<string, unknown>> {
  assertRs256(token);
  try {
    const { payload } = await jwtVerify(
      token,
      createLocalJWKSet({ keys: config.jwks } as JSONWebKeySet),
      {
        algorithms: ["RS256"],
        audience: config.audience,
        clockTolerance: config.clockToleranceSeconds ?? 60,
        issuer: config.issuer,
        requiredClaims: ["exp", "iss", "aud"],
        ...(config.now === undefined ? {} : { currentDate: config.now }),
      },
    );
    return { ...payload };
  } catch (error) {
    throw mapJoseError(error);
  }
}

function assertRs256(token: string): void {
  try {
    if (decodeProtectedHeader(token).alg !== "RS256") {
      throw new OidcJwtVerificationError("OIDC token must use RS256.");
    }
  } catch (error) {
    if (error instanceof OidcJwtVerificationError) throw error;
    throw new OidcJwtVerificationError("OIDC token must be a compact JWT.");
  }
}

function mapJoseError(error: unknown): OidcJwtVerificationError {
  if (error instanceof joseErrors.JWTExpired) {
    return new OidcJwtVerificationError("OIDC token has expired.");
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === "aud") {
      return new OidcJwtVerificationError("OIDC token audience is invalid.");
    }
    if (error.claim === "iss") {
      return new OidcJwtVerificationError("OIDC token issuer is invalid.");
    }
    if (error.claim === "nbf") {
      return new OidcJwtVerificationError("OIDC token is not active yet.");
    }
    if (error.claim === "iat") {
      return new OidcJwtVerificationError(
        "OIDC token was issued in the future.",
      );
    }
    if (error.claim === "exp") {
      return new OidcJwtVerificationError("OIDC token must include exp.");
    }
  }
  if (error instanceof joseErrors.JWKSNoMatchingKey) {
    return new OidcJwtVerificationError("OIDC signing key was not found.");
  }
  if (
    error instanceof joseErrors.JWSSignatureVerificationFailed ||
    error instanceof joseErrors.JWSInvalid
  ) {
    return new OidcJwtVerificationError("OIDC token signature is invalid.");
  }
  return new OidcJwtVerificationError("OIDC token verification failed.");
}
