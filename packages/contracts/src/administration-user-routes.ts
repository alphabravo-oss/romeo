import { createRoute } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import {
  AdminUserListQuerySchema,
  AdminUserPageSchema,
  AdminUserTablePageSchema,
  AdminUserTableQuerySchema,
} from "./administration-users";

const metadata = { tags: ["Administration"], security: authenticationSecurity };

export const listUsersRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/users",
  operationId: "administration.listUsers",
  summary: "List organization users",
  request: {
    query: AdminUserListQuerySchema,
  },
  responses: {
    200: jsonResponse("Users", AdminUserPageSchema),
    ...standardErrorResponses,
  },
});

export const queryUsersRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/users/query",
  operationId: "administration.queryUsers",
  summary: "Query organization users with server-driven keyset pagination",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: AdminUserTableQuerySchema } },
    },
  },
  responses: {
    200: jsonResponse("User table page", AdminUserTablePageSchema),
    ...standardErrorResponses,
  },
});
