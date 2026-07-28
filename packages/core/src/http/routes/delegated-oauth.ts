import {
  completeDelegatedOAuthRoute,
  getDelegatedOAuthPostureRoute,
  listDelegatedOAuthConnectionsRoute,
  listDelegatedOAuthProvidersRoute,
  revokeDelegatedOAuthConnectionRoute,
  startDelegatedOAuthRoute,
} from "@romeo/contracts";

import { ApiError } from "../../errors";
import type { RomeoApi } from "../context";
import { shouldSecureCookie } from "../cookie-security";
import {
  clearDelegatedOAuthCookie,
  createDelegatedOAuthCookie,
  delegatedOAuthCookieName,
} from "../delegated-oauth-cookie";
import { readCookie } from "../session-cookie";

export function registerDelegatedOAuthRoutes(app: RomeoApi): void {
  app.openapi(listDelegatedOAuthProvidersRoute, async (context) => {
    const subject = context.get("subject");
    const data = context.get("services").delegatedOAuth.listProviders(subject);
    return context.json({ data }, 200);
  });

  app.openapi(getDelegatedOAuthPostureRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .delegatedOAuth.adminPosture(subject);
    return context.json({ data }, 200);
  });

  app.openapi(startDelegatedOAuthRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = context.get("services").delegatedOAuth.start({
      subject,
      providerId: body.providerId,
      workspaceId: body.workspaceId,
      connectorType: body.connectorType,
      ...(body.scopes === undefined ? {} : { scopes: body.scopes }),
      ...(body.returnTo === undefined ? {} : { returnTo: body.returnTo }),
    });
    context.header(
      "set-cookie",
      createDelegatedOAuthCookie(
        data.stateCookie,
        data.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    const { stateCookie: _stateCookie, ...safeData } = data;
    return context.json({ data: safeData }, 200);
  });

  app.openapi(listDelegatedOAuthConnectionsRoute, async (context) => {
    const subject = context.get("subject");
    const { workspaceId } = context.req.valid("query");
    const data = await context
      .get("services")
      .delegatedOAuth.listConnections(subject, workspaceId);
    return context.json({ data }, 200);
  });

  app.openapi(revokeDelegatedOAuthConnectionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").delegatedOAuth.revoke({
      subject,
      connectionId: context.req.valid("param").connectionId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(completeDelegatedOAuthRoute, async (context) => {
    const secure = shouldSecureCookie(context);
    context.header("set-cookie", clearDelegatedOAuthCookie(secure));
    const query = context.req.valid("query");
    const providerError = query.error;
    if (providerError !== undefined) {
      throw new ApiError(
        "delegated_oauth_authorization_error",
        "Delegated OAuth provider rejected the authorization request.",
        400,
        { providerError: providerError.slice(0, 120) },
      );
    }

    const code = query.code;
    const state = query.state;
    if (code === undefined || state === undefined) {
      throw new ApiError(
        "delegated_oauth_callback_invalid",
        "Delegated OAuth callback must include code and state.",
        400,
      );
    }

    const stateCookie = readCookie(
      context.req.header("cookie"),
      delegatedOAuthCookieName,
    );
    const data = await context.get("services").delegatedOAuth.complete({
      code,
      state,
      ...(stateCookie === undefined ? {} : { stateCookie }),
    });
    const response = context.redirect(data.returnTo);
    response.headers.set("set-cookie", clearDelegatedOAuthCookie(secure));
    return response;
  });
}
