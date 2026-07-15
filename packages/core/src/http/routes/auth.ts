import { ApiError } from "../../errors";
import {
  authProviderIds,
  type AuthProviderId,
} from "../../domain/auth-providers";
import type { RomeoApi } from "../context";
import { shouldSecureCookie } from "../cookie-security";
import {
  clearOidcPkceCookie,
  createOidcPkceCookie,
  oidcPkceCookieName,
} from "../oidc-pkce-cookie";
import {
  clearOAuth2PkceCookie,
  createOAuth2PkceCookie,
  oauth2PkceCookieName,
} from "../oauth2-pkce-cookie";
import {
  clearSamlStateCookie,
  createSamlStateCookie,
  samlStateCookieName,
} from "../saml-state-cookie";
import { readCookie, createSessionCookie } from "../session-cookie";
import {
  ldapLoginSchema,
  localLoginSchema,
  localMfaVerifySchema,
  recoveryCodesGenerateSchema,
  setLocalPasswordSchema,
  totpConfirmSchema,
  totpDisableSchema,
  totpEnrollmentSchema,
} from "../schemas";

export function registerAuthRoutes(app: RomeoApi): void {
  app.post("/api/v1/auth/local/login", async (context) => {
    const body = localLoginSchema.parse(await context.req.json());
    const data = await context.get("services").localAuth.login({
      email: body.email,
      password: body.password,
      ...(body.orgId === undefined ? {} : { orgId: body.orgId }),
      ...(body.totpCode === undefined ? {} : { totpCode: body.totpCode }),
      ...(body.recoveryCode === undefined
        ? {}
        : { recoveryCode: body.recoveryCode }),
    });
    if (data.status === "authenticated") {
      context.header(
        "set-cookie",
        createSessionCookie(
          data.token,
          data.session.expiresAt,
          shouldSecureCookie(context),
        ),
      );
    }
    return context.json({ data });
  });

  app.post("/api/v1/auth/ldap/login", async (context) => {
    const body = ldapLoginSchema.parse(await context.req.json());
    const data = await context.get("services").ldapAuth.login({
      identifier: body.identifier,
      password: body.password,
      providerId: body.providerId,
      ...(body.orgId === undefined ? {} : { orgId: body.orgId }),
    });
    context.header(
      "set-cookie",
      createSessionCookie(
        data.token,
        data.session.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    return context.json({ data });
  });

  app.post("/api/v1/auth/local/mfa/verify", async (context) => {
    const body = localMfaVerifySchema.parse(await context.req.json());
    const data = await context.get("services").localAuth.verifyMfaLogin({
      challengeToken: body.challengeToken,
      ...(body.code === undefined ? {} : { code: body.code }),
      ...(body.recoveryCode === undefined
        ? {}
        : { recoveryCode: body.recoveryCode }),
    });
    context.header(
      "set-cookie",
      createSessionCookie(
        data.token,
        data.session.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    return context.json({ data: { status: "authenticated", ...data } });
  });

  app.get("/api/v1/auth/local/status", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").localAuth.status(subject);
    return context.json({ data });
  });

  app.post("/api/v1/auth/local/password", async (context) => {
    const subject = context.get("subject");
    const body = setLocalPasswordSchema.parse(await context.req.json());
    const data = await context.get("services").localAuth.setOwnPassword({
      subject,
      newPassword: body.newPassword,
      ...(body.currentPassword === undefined
        ? {}
        : { currentPassword: body.currentPassword }),
    });
    return context.json({ data });
  });

  app.post("/api/v1/auth/local/mfa/totp/enroll", async (context) => {
    const subject = context.get("subject");
    const body = totpEnrollmentSchema.parse(await context.req.json());
    const data = await context.get("services").localAuth.startTotpEnrollment({
      subject,
      ...(body.name === undefined ? {} : { name: body.name }),
    });
    return context.json({ data }, 201);
  });

  app.post("/api/v1/auth/local/mfa/totp/confirm", async (context) => {
    const subject = context.get("subject");
    const body = totpConfirmSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .localAuth.confirmTotpEnrollment({ subject, ...body });
    return context.json({ data });
  });

  app.post(
    "/api/v1/auth/local/mfa/recovery-codes/generate",
    async (context) => {
      const subject = context.get("subject");
      const body = recoveryCodesGenerateSchema.parse(await context.req.json());
      const data = await context
        .get("services")
        .localAuth.generateRecoveryCodes({
          subject,
          totpCode: body.totpCode,
        });
      return context.json({ data }, 201);
    },
  );

  app.post(
    "/api/v1/auth/local/mfa/factors/:factorId/disable",
    async (context) => {
      const subject = context.get("subject");
      const body = totpDisableSchema.parse(await context.req.json());
      const data = await context.get("services").localAuth.disableTotpFactor({
        subject,
        factorId: context.req.param("factorId"),
        ...(body.code === undefined ? {} : { code: body.code }),
      });
      return context.json({ data });
    },
  );

  app.get("/api/v1/auth/oidc/start", async (context) => {
    const returnTo = context.req.query("returnTo");
    const orgId = context.req.query("orgId");
    const providerId = parseProviderId(context.req.query("providerId"));
    const data = await context.get("services").oidcPkce.start({
      ...(orgId === undefined ? {} : { orgId }),
      ...(returnTo === undefined ? {} : { returnTo }),
      ...(providerId === undefined ? {} : { providerId }),
    });
    context.header(
      "set-cookie",
      createOidcPkceCookie(
        data.stateCookie,
        data.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    return context.json({
      data: {
        authorizationUrl: data.authorizationUrl,
        expiresAt: data.expiresAt,
        orgId: data.orgId,
        ...(data.providerId === undefined
          ? {}
          : { providerId: data.providerId }),
      },
    });
  });

  app.get("/api/v1/auth/oidc/callback", async (context) => {
    const providerError = context.req.query("error");
    if (providerError !== undefined) {
      throw new ApiError(
        "oidc_authorization_error",
        "OIDC provider rejected the authorization request.",
        400,
        {
          providerError: providerError.slice(0, 120),
        },
      );
    }

    const code = context.req.query("code");
    const state = context.req.query("state");
    if (code === undefined || state === undefined)
      throw new ApiError(
        "oidc_callback_invalid",
        "OIDC callback must include code and state.",
        400,
      );

    const stateCookie = readCookie(
      context.req.header("cookie"),
      oidcPkceCookieName,
    );
    const data = await context.get("services").oidcPkce.complete({
      code,
      state,
      ...(stateCookie === undefined ? {} : { stateCookie }),
    });
    const secure = shouldSecureCookie(context);
    const response = context.redirect(data.returnTo);
    response.headers.append(
      "set-cookie",
      createSessionCookie(data.token, data.session.expiresAt, secure),
    );
    response.headers.append("set-cookie", clearOidcPkceCookie(secure));
    return response;
  });

  app.get("/api/v1/auth/oauth2/start", async (context) => {
    const providerId = parseProviderId(context.req.query("providerId"));
    if (providerId === undefined) {
      throw new ApiError(
        "invalid_oauth2_provider",
        "OAuth2 provider ID is required.",
        400,
      );
    }
    const returnTo = context.req.query("returnTo");
    const orgId = context.req.query("orgId");
    const data = await context.get("services").oauth2Pkce.start({
      providerId,
      ...(orgId === undefined ? {} : { orgId }),
      ...(returnTo === undefined ? {} : { returnTo }),
    });
    context.header(
      "set-cookie",
      createOAuth2PkceCookie(
        data.stateCookie,
        data.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    return context.json({
      data: {
        authorizationUrl: data.authorizationUrl,
        expiresAt: data.expiresAt,
        providerId: data.providerId,
      },
    });
  });

  app.get("/api/v1/auth/oauth2/callback", async (context) => {
    const providerError = context.req.query("error");
    if (providerError !== undefined) {
      throw new ApiError(
        "oauth2_authorization_error",
        "OAuth2 provider rejected the authorization request.",
        400,
        { providerError: providerError.slice(0, 120) },
      );
    }

    const code = context.req.query("code");
    const state = context.req.query("state");
    if (code === undefined || state === undefined) {
      throw new ApiError(
        "oauth2_callback_invalid",
        "OAuth2 callback must include code and state.",
        400,
      );
    }
    const stateCookie = readCookie(
      context.req.header("cookie"),
      oauth2PkceCookieName,
    );
    const data = await context.get("services").oauth2Pkce.complete({
      code,
      state,
      ...(stateCookie === undefined ? {} : { stateCookie }),
    });
    const secure = shouldSecureCookie(context);
    const response = context.redirect(data.returnTo);
    response.headers.append(
      "set-cookie",
      createSessionCookie(data.token, data.session.expiresAt, secure),
    );
    response.headers.append("set-cookie", clearOAuth2PkceCookie(secure));
    return response;
  });

  app.get("/api/v1/auth/saml/start", async (context) => {
    const providerId = parseProviderId(context.req.query("providerId"));
    const returnTo = context.req.query("returnTo");
    const orgId = context.req.query("orgId");
    const data = await context.get("services").samlAuth.start({
      ...(providerId === undefined ? {} : { providerId }),
      ...(orgId === undefined ? {} : { orgId }),
      ...(returnTo === undefined ? {} : { returnTo }),
    });
    context.header(
      "set-cookie",
      createSamlStateCookie(
        data.stateCookie,
        data.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    return context.json({
      data: {
        authorizationUrl: data.authorizationUrl,
        expiresAt: data.expiresAt,
        providerId: data.providerId,
      },
    });
  });

  app.post("/api/v1/auth/saml/callback", async (context) => {
    const body = await parseSamlCallbackBody(context.req.raw);
    const stateCookie = readCookie(
      context.req.header("cookie"),
      samlStateCookieName,
    );
    const data = await context.get("services").samlAuth.complete({
      samlResponse: body.samlResponse,
      ...(body.relayState === undefined ? {} : { relayState: body.relayState }),
      ...(stateCookie === undefined ? {} : { stateCookie }),
    });
    const secure = shouldSecureCookie(context);
    const response = context.redirect(data.returnTo);
    response.headers.append(
      "set-cookie",
      createSessionCookie(data.token, data.session.expiresAt, secure),
    );
    response.headers.append("set-cookie", clearSamlStateCookie(secure));
    return response;
  });

  app.get("/api/v1/auth/saml/metadata", async (context) => {
    const providerId = parseProviderId(context.req.query("providerId"));
    const orgId = context.req.query("orgId");
    const metadata = await context.get("services").samlAuth.metadata({
      ...(providerId === undefined ? {} : { providerId }),
      ...(orgId === undefined ? {} : { orgId }),
    });
    return new Response(metadata, {
      headers: {
        "content-type": "application/samlmetadata+xml; charset=utf-8",
      },
    });
  });
}

function parseProviderId(
  value: string | undefined,
): AuthProviderId | undefined {
  if (value === undefined) return undefined;
  if (authProviderIds.includes(value as AuthProviderId))
    return value as AuthProviderId;
  throw new ApiError(
    "invalid_oidc_provider",
    "OIDC provider ID is not recognized.",
    400,
    { providerId: value },
  );
}

async function parseSamlCallbackBody(
  request: Request,
): Promise<{ relayState?: string; samlResponse: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  const params = contentType.includes("multipart/form-data")
    ? formDataToParams(await request.formData())
    : new URLSearchParams(await request.text());
  const samlResponse = params.get("SAMLResponse");
  if (samlResponse === null || samlResponse.length === 0) {
    throw new ApiError(
      "saml_callback_invalid",
      "SAML callback must include SAMLResponse.",
      400,
    );
  }
  if (samlResponse.length > 200_000) {
    throw new ApiError(
      "saml_callback_invalid",
      "SAML callback response is too large.",
      400,
    );
  }
  const relayState = params.get("RelayState") ?? undefined;
  if (relayState !== undefined && relayState.length > 4_000) {
    throw new ApiError(
      "saml_callback_invalid",
      "SAML callback RelayState is too large.",
      400,
    );
  }
  return {
    samlResponse,
    ...(relayState === undefined ? {} : { relayState }),
  };
}

function formDataToParams(formData: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params.append(key, value);
  }
  return params;
}
