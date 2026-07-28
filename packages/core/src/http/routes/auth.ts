import { ApiError } from "../../errors";
import {
  completeOAuth2LoginRoute,
  completeOidcLoginRoute,
  completeSamlLoginRoute,
  confirmTotpEnrollmentRoute,
  disableTotpFactorRoute,
  generateRecoveryCodesRoute,
  getLocalAuthStatusRoute,
  getSamlMetadataRoute,
  ldapLoginRoute,
  localLoginRoute,
  setLocalPasswordRoute,
  startOAuth2LoginRoute,
  startOidcLoginRoute,
  startSamlLoginRoute,
  startTotpEnrollmentRoute,
  verifyLocalMfaRoute,
} from "@romeo/contracts";
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

export function registerAuthRoutes(app: RomeoApi): void {
  app.openapi(localLoginRoute, async (context) => {
    const body = context.req.valid("json");
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
    return context.json({ data }, 200);
  });

  app.openapi(ldapLoginRoute, async (context) => {
    const body = context.req.valid("json");
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
    return context.json({ data }, 200);
  });

  app.openapi(verifyLocalMfaRoute, async (context) => {
    const body = context.req.valid("json");
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
    return context.json(
      { data: { status: "authenticated" as const, ...data } },
      200,
    );
  });

  app.openapi(getLocalAuthStatusRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").localAuth.status(subject);
    return context.json({ data }, 200);
  });

  app.openapi(setLocalPasswordRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").localAuth.setOwnPassword({
      subject,
      newPassword: body.newPassword,
      ...(body.currentPassword === undefined
        ? {}
        : { currentPassword: body.currentPassword }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(startTotpEnrollmentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").localAuth.startTotpEnrollment({
      subject,
      ...(body.name === undefined ? {} : { name: body.name }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(confirmTotpEnrollmentRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .localAuth.confirmTotpEnrollment({ subject, ...body });
    return context.json({ data }, 200);
  });

  app.openapi(generateRecoveryCodesRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").localAuth.generateRecoveryCodes({
      subject,
      totpCode: body.totpCode,
    });
    return context.json({ data }, 201);
  });

  app.openapi(disableTotpFactorRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").localAuth.disableTotpFactor({
      subject,
      factorId: context.req.valid("param").factorId,
      ...(body.code === undefined ? {} : { code: body.code }),
    });
    return context.json({ data }, 200);
  });

  app.openapi(startOidcLoginRoute, async (context) => {
    const { orgId, providerId, returnTo } = context.req.valid("query");
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
    return context.json(
      {
        data: {
          authorizationUrl: data.authorizationUrl,
          expiresAt: data.expiresAt,
          orgId: data.orgId,
          ...(providerId === undefined ? {} : { providerId }),
        },
      },
      200,
    );
  });

  app.openapi(completeOidcLoginRoute, async (context) => {
    const { code, error: providerError, state } = context.req.valid("query");
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

  app.openapi(startOAuth2LoginRoute, async (context) => {
    const { orgId, providerId, returnTo } = context.req.valid("query");
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
    return context.json(
      {
        data: {
          authorizationUrl: data.authorizationUrl,
          expiresAt: data.expiresAt,
          providerId,
        },
      },
      200,
    );
  });

  app.openapi(completeOAuth2LoginRoute, async (context) => {
    const { code, error: providerError, state } = context.req.valid("query");
    if (providerError !== undefined) {
      throw new ApiError(
        "oauth2_authorization_error",
        "OAuth2 provider rejected the authorization request.",
        400,
        { providerError: providerError.slice(0, 120) },
      );
    }

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

  app.openapi(startSamlLoginRoute, async (context) => {
    const { orgId, providerId, returnTo } = context.req.valid("query");
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
    return context.json(
      {
        data: {
          authorizationUrl: data.authorizationUrl,
          expiresAt: data.expiresAt,
          providerId: data.providerId,
        },
      },
      200,
    );
  });

  app.openapi(completeSamlLoginRoute, async (context) => {
    const body = context.req.valid("form");
    const stateCookie = readCookie(
      context.req.header("cookie"),
      samlStateCookieName,
    );
    const data = await context.get("services").samlAuth.complete({
      samlResponse: body.SAMLResponse,
      ...(body.RelayState === undefined ? {} : { relayState: body.RelayState }),
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

  app.openapi(getSamlMetadataRoute, async (context) => {
    const { orgId, providerId } = context.req.valid("query");
    const metadata = await context.get("services").samlAuth.metadata({
      ...(providerId === undefined ? {} : { providerId }),
      ...(orgId === undefined ? {} : { orgId }),
    });
    return context.body(metadata, 200, {
      "content-type": "application/samlmetadata+xml; charset=utf-8",
    });
  });
}
