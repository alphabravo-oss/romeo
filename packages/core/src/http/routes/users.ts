import {
  directorySyncRoute,
  disableUserRoute,
  listUsersRoute,
  setUserLocalPasswordRoute,
  updateUserRoleRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerUserRoutes(app: RomeoApi): void {
  app.openapi(listUsersRoute, async (context) => {
    const subject = context.get("subject");
    const users = await context.get("services").users.list(subject);
    const data = users.map(withEffectiveRole);
    return context.json({ data });
  });

  app.openapi(disableUserRoute, async (context) => {
    const subject = context.get("subject");
    const user = await context
      .get("services")
      .users.disable({ subject, userId: context.req.valid("param").userId });
    const data = withEffectiveRole(user);
    return context.json({ data });
  });

  app.openapi(updateUserRoleRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const user = await context.get("services").users.updateRole({
      subject,
      userId: context.req.valid("param").userId,
      confirmUserId: body.confirmUserId,
      role: body.role,
    });
    const data = withEffectiveRole(user);
    return context.json({ data });
  });

  app.openapi(setUserLocalPasswordRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").localAuth.setUserPassword({
      subject,
      userId: context.req.valid("param").userId,
      confirmUserId: body.confirmUserId,
      newPassword: body.newPassword,
    });
    return context.json({ data });
  });

  app.openapi(directorySyncRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .directorySync.reconcile(subject, body);
    return context.json({ data });
  });
}

function withEffectiveRole<
  T extends { role?: "user" | "org_admin" | "global_admin" },
>(user: T): T & { role: "user" | "org_admin" | "global_admin" } {
  return { ...user, role: user.role ?? "user" };
}
