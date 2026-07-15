import type { RomeoApi } from "../context";
import { shouldSecureCookie } from "../cookie-security";
import {
  createSessionSchema,
  createSupportSessionRequestSchema,
  createSupportSessionSchema,
} from "../schemas";
import { clearSessionCookie, createSessionCookie } from "../session-cookie";

export function registerSessionRoutes(app: RomeoApi): void {
  app.get("/api/v1/sessions", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.list(subject);
    return context.json({ data });
  });

  app.post("/api/v1/sessions", async (context) => {
    const subject = context.get("subject");
    const body = createSessionSchema.parse(
      await context.req.json().catch(() => ({})),
    );
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

  app.post("/api/v1/admin/impersonation/sessions", async (context) => {
    const subject = context.get("subject");
    const body = createSupportSessionSchema.parse(await context.req.json());
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

  app.get("/api/v1/admin/impersonation/sessions", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .sessions.listSupportSessions(subject);
    return context.json({ data });
  });

  app.post(
    "/api/v1/admin/impersonation/sessions/:sessionId/revoke",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").sessions.revokeSupportSession({
        subject,
        sessionId: context.req.param("sessionId"),
      });
      return context.json({ data });
    },
  );

  app.get("/api/v1/admin/impersonation/requests", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .sessions.listSupportSessionRequests(subject);
    return context.json({ data });
  });

  app.post("/api/v1/admin/impersonation/requests", async (context) => {
    const subject = context.get("subject");
    const body = createSupportSessionRequestSchema.parse(
      await context.req.json(),
    );
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

  app.post(
    "/api/v1/admin/impersonation/requests/:requestId/approve",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .sessions.approveSupportSessionRequest({
          subject,
          requestId: context.req.param("requestId"),
        });
      return context.json({ data }, 201);
    },
  );

  app.post(
    "/api/v1/admin/impersonation/requests/:requestId/reject",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .sessions.rejectSupportSessionRequest({
          subject,
          requestId: context.req.param("requestId"),
        });
      return context.json({ data });
    },
  );

  app.post("/api/v1/sessions/revoke-others", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revokeOthers(subject);
    return context.json({ data });
  });

  app.delete("/api/v1/sessions/current", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revokeCurrent(subject);
    context.header(
      "set-cookie",
      clearSessionCookie(shouldSecureCookie(context)),
    );
    return context.json({ data });
  });

  app.delete("/api/v1/sessions/:sessionId", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").sessions.revoke({
      subject,
      sessionId: context.req.param("sessionId"),
    });
    return context.json({ data });
  });
}
