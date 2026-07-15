import { ApiError } from "../../errors";
import type { RomeoApi } from "../context";
import { shouldSecureCookie } from "../cookie-security";
import {
  clearDelegatedOAuthCookie,
  createDelegatedOAuthCookie,
  delegatedOAuthCookieName,
} from "../delegated-oauth-cookie";
import { startDelegatedOAuthSchema } from "../schemas";
import { readCookie } from "../session-cookie";

export function registerDelegatedOAuthRoutes(app: RomeoApi): void {
  app.get("/api/v1/delegated-oauth/providers", async (context) => {
    const subject = context.get("subject");
    const data = context.get("services").delegatedOAuth.listProviders(subject);
    return context.json({ data });
  });

  app.get("/api/v1/admin/delegated-oauth/posture", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .delegatedOAuth.adminPosture(subject);
    return context.json({ data });
  });

  app.post("/api/v1/delegated-oauth/start", async (context) => {
    const subject = context.get("subject");
    const body = startDelegatedOAuthSchema.parse(await context.req.json());
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
    return context.json({ data: safeData });
  });

  app.get("/api/v1/delegated-oauth/connections", async (context) => {
    const subject = context.get("subject");
    const workspaceId = context.req.query("workspaceId");
    const data = await context
      .get("services")
      .delegatedOAuth.listConnections(subject, workspaceId);
    return context.json({ data });
  });

  app.post(
    "/api/v1/delegated-oauth/connections/:connectionId/revoke",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").delegatedOAuth.revoke({
        subject,
        connectionId: context.req.param("connectionId"),
      });
      return context.json({ data });
    },
  );

  app.get("/api/v1/delegated-oauth/callback", async (context) => {
    const secure = shouldSecureCookie(context);
    context.header("set-cookie", clearDelegatedOAuthCookie(secure));
    const providerError = context.req.query("error");
    if (providerError !== undefined) {
      throw new ApiError(
        "delegated_oauth_authorization_error",
        "Delegated OAuth provider rejected the authorization request.",
        400,
        { providerError: providerError.slice(0, 120) },
      );
    }

    const code = context.req.query("code");
    const state = context.req.query("state");
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
