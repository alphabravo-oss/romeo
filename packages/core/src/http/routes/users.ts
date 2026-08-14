import {
  directorySyncRoute,
  disableUserRoute,
  listUsersRoute,
  queryUsersRoute,
  setUserLocalPasswordRoute,
  updateUserRoleRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerUserRoutes(app: RomeoApi): void {
  app.openapi(listUsersRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const page = await context.get("services").users.listPage(subject, {
      direction: query.direction ?? "asc",
      limit,
      offset,
      ...(query.q === undefined || query.q === "" ? {} : { query: query.q }),
      sort: query.sort ?? "name",
    });
    const data = page.items.map(withEffectiveRole);
    return context.json({
      data,
      meta: {
        activeGlobalAdminTotal: page.activeGlobalAdminTotal,
        adminTotal: page.adminTotal,
        disabledTotal: page.disabledTotal,
        hasMore: offset + data.length < page.total,
        limit,
        offset,
        total: page.total,
        userTotal: page.userTotal,
      },
    });
  });

  app.openapi(queryUsersRoute, async (context) => {
    const request = context.req.valid("json");
    const page = await context
      .get("services")
      .users.queryTable(context.get("subject"), {
        filters: request.filters,
        limit: request.limit,
        sort: request.sort.map((sort) => ({
          direction: sort.direction,
          field: sort.field,
          ...(sort.nulls === undefined ? {} : { nulls: sort.nulls }),
        })),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.search === undefined ? {} : { search: request.search }),
      });
    return context.json(page);
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
