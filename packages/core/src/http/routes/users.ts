import type { RomeoApi } from "../context";
import {
  adminSetLocalPasswordSchema,
  directorySyncSchema,
  updateUserRoleSchema,
} from "../schemas";

export function registerUserRoutes(app: RomeoApi): void {
  app.get("/api/v1/users", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").users.list(subject);
    return context.json({ data });
  });

  app.post("/api/v1/users/:userId/disable", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .users.disable({ subject, userId: context.req.param("userId") });
    return context.json({ data });
  });

  app.patch("/api/v1/users/:userId/role", async (context) => {
    const subject = context.get("subject");
    const body = updateUserRoleSchema.parse(await context.req.json());
    const data = await context.get("services").users.updateRole({
      subject,
      userId: context.req.param("userId"),
      confirmUserId: body.confirmUserId,
      role: body.role,
    });
    return context.json({ data });
  });

  app.post("/api/v1/users/:userId/local-password", async (context) => {
    const subject = context.get("subject");
    const body = adminSetLocalPasswordSchema.parse(await context.req.json());
    const data = await context.get("services").localAuth.setUserPassword({
      subject,
      userId: context.req.param("userId"),
      confirmUserId: body.confirmUserId,
      newPassword: body.newPassword,
    });
    return context.json({ data });
  });

  app.post("/api/v1/admin/directory-sync", async (context) => {
    const subject = context.get("subject");
    const body = directorySyncSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .directorySync.reconcile(subject, body);
    return context.json({ data });
  });
}
