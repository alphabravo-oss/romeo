import { z } from "@hono/zod-openapi";

import {
  createServerTablePageSchema,
  createServerTableQuerySchema,
} from "./server-table";

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

export const AdminUserTableQuerySchema = createServerTableQuerySchema({
  sortFields: ["name", "email"],
  filters: {
    role: {
      eq: adminUserRoleSchema,
      in: z.array(adminUserRoleSchema).min(1).max(3),
    },
    status: { eq: z.enum(["active", "disabled"]) },
  },
  defaultSort: [{ field: "name", direction: "asc" }],
  maxFilters: 2,
  maxLimit: 100,
  maxSorts: 1,
  search: { minLength: 3, maxLength: 200 },
}).openapi("AdminUserTableQuery");

const AdminUserTablePageBaseSchema =
  createServerTablePageSchema(AdminUserSchema);

export const AdminUserTablePageSchema = z
  .strictObject({
    data: AdminUserTablePageBaseSchema.shape.data.extend({
      summary: z.strictObject({
        activeGlobalAdminTotal: z.number().int().nonnegative(),
        adminTotal: z.number().int().nonnegative(),
        disabledTotal: z.number().int().nonnegative(),
        userTotal: z.number().int().nonnegative(),
      }),
    }),
  })
  .openapi("AdminUserTablePage");

export const AdminUserListQuerySchema = z.strictObject({
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["email", "name", "role", "status"]).optional(),
});
