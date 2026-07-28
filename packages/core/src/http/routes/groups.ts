import {
  addGroupMemberRoute,
  createGroupRoute,
  listGroupMembersRoute,
  listGroupsRoute,
  removeGroupMemberRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerGroupRoutes(app: RomeoApi): void {
  app.openapi(listGroupsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").groups.list(subject);
    return context.json({ data });
  });

  app.openapi(createGroupRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .groups.create({ subject, name: body.name, slug: body.slug });
    return context.json({ data }, 201);
  });

  app.openapi(listGroupMembersRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .groups.members(subject, context.req.valid("param").groupId);
    return context.json({ data });
  });

  app.openapi(addGroupMemberRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").groups.addMember({
      subject,
      groupId: context.req.valid("param").groupId,
      userId: body.userId,
    });
    return context.json({ data }, 201);
  });

  app.openapi(removeGroupMemberRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").groups.removeMember({
      subject,
      groupId: context.req.valid("param").groupId,
      userId: context.req.valid("param").userId,
    });
    return context.json({ data });
  });
}
