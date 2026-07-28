import {
  approveSupportSessionRequestRoute,
  createSessionRoute,
  createSupportSessionRequestRoute,
  createSupportSessionRoute,
  listSessionsRoute,
  listSupportSessionRequestsRoute,
  listSupportSessionsRoute,
  rejectSupportSessionRequestRoute,
  revokeCurrentSessionRoute,
  revokeOtherSessionsRoute,
  revokeSessionRoute,
  revokeSupportSessionRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";
import { shouldSecureCookie } from "../cookie-security";
import { clearSessionCookie, createSessionCookie } from "../session-cookie";

export function registerSessionRoutes(app: RomeoApi): void {
  app.openapi(listSessionsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.list(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createSessionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? { name: "Local session" };
    const data = await context.get("services").sessions.create({
      subject,
      name: body.name,
      ...(body.ttlHours === undefined ? {} : { ttlHours: body.ttlHours }),
    });
    context.header(
      "set-cookie",
      createSessionCookie(
        data.token,
        data.session.expiresAt,
        shouldSecureCookie(context),
      ),
    );
    return context.json({ data }, 201);
  });

  app.openapi(createSupportSessionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").sessions.createSupportSession({
      subject,
      targetUserId: body.targetUserId,
      confirmTargetUserId: body.confirmTargetUserId,
      reason: body.reason,
      ...(body.ticketRef === undefined ? {} : { ticketRef: body.ticketRef }),
      ...(body.ttlMinutes === undefined ? {} : { ttlMinutes: body.ttlMinutes }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(listSupportSessionsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .sessions.listSupportSessions(subject);
    return context.json({ data }, 200);
  });

  app.openapi(revokeSupportSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revokeSupportSession({
      subject,
      sessionId: context.req.valid("param").sessionId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(listSupportSessionRequestsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .sessions.listSupportSessionRequests(subject);
    return context.json({ data }, 200);
  });

  app.openapi(createSupportSessionRequestRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").sessions.requestSupportSession({
      subject,
      targetUserId: body.targetUserId,
      confirmTargetUserId: body.confirmTargetUserId,
      reason: body.reason,
      ...(body.ticketRef === undefined ? {} : { ticketRef: body.ticketRef }),
      ...(body.ttlMinutes === undefined ? {} : { ttlMinutes: body.ttlMinutes }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(approveSupportSessionRequestRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .sessions.approveSupportSessionRequest({
        subject,
        requestId: context.req.valid("param").requestId,
      });
    return context.json({ data }, 201);
  });

  app.openapi(rejectSupportSessionRequestRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .sessions.rejectSupportSessionRequest({
        subject,
        requestId: context.req.valid("param").requestId,
      });
    return context.json({ data }, 200);
  });

  app.openapi(revokeOtherSessionsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revokeOthers(subject);
    return context.json({ data }, 200);
  });

  app.openapi(revokeCurrentSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revokeCurrent(subject);
    context.header(
      "set-cookie",
      clearSessionCookie(shouldSecureCookie(context)),
    );
    return context.json({ data }, 200);
  });

  app.openapi(revokeSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revoke({
      subject,
      sessionId: context.req.valid("param").sessionId,
    });
    return context.json({ data }, 200);
  });
}
