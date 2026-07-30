import { z } from "@hono/zod-openapi";

export const administrationIdentifierSchema = z.string().trim().min(1).max(300);
export const adminUserRoleSchema = z.enum([
  "user",
  "org_admin",
  "global_admin",
]);

export const AdminUserSchema = z
  .strictObject({
    id: administrationIdentifierSchema,
    orgId: administrationIdentifierSchema,
    email: z.email(),
    name: z.string().min(1),
    role: adminUserRoleSchema,
    disabledAt: z.iso.datetime().optional(),
  })
  .openapi("AdminUser");

export const AdminUserPageSchema = z
  .strictObject({
    data: z.array(AdminUserSchema),
    meta: z.strictObject({
      activeGlobalAdminTotal: z.number().int().nonnegative(),
      adminTotal: z.number().int().nonnegative(),
      disabledTotal: z.number().int().nonnegative(),
      hasMore: z.boolean(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      userTotal: z.number().int().nonnegative(),
    }),
  })
  .openapi("AdminUserPage");

export const AdminUserListQuerySchema = z.strictObject({
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["email", "name", "role", "status"]).optional(),
});
