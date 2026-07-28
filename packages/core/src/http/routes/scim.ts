import { AuthorizationError } from "@romeo/auth";
import {
  createScimGroupRoute,
  createScimUserRoute,
  deleteScimGroupRoute,
  deleteScimUserRoute,
  getScimGroupRoute,
  getScimServiceProviderConfigRoute,
  getScimUserRoute,
  listScimGroupsRoute,
  listScimResourceTypesRoute,
  listScimSchemasRoute,
  listScimUsersRoute,
  patchScimGroupRoute,
  patchScimUserRoute,
  replaceScimGroupRoute,
  replaceScimUserRoute,
} from "@romeo/contracts";
import type { Context } from "hono";
import { ZodError } from "zod";

import { ApiError } from "../../errors";
import { scimErrorSchema } from "../../services/scim-resource";
import type { AppBindings, RomeoApi } from "../context";

export function registerScimRoutes(app: RomeoApi): void {
  app.openapi(
    getScimServiceProviderConfigRoute,
    async (context) =>
      scimRoute(context, async () =>
        context
          .get("services")
          .scim.serviceProviderConfig(context.get("subject"), baseUrl(context)),
      ),
    scimValidationHook,
  );

  app.openapi(
    listScimSchemasRoute,
    async (context) =>
      scimRoute(context, async () =>
        context
          .get("services")
          .scim.schemas(context.get("subject"), baseUrl(context)),
      ),
    scimValidationHook,
  );

  app.openapi(
    listScimResourceTypesRoute,
    async (context) =>
      scimRoute(context, async () =>
        context
          .get("services")
          .scim.resourceTypes(context.get("subject"), baseUrl(context)),
      ),
    scimValidationHook,
  );

  app.openapi(
    listScimUsersRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.listUsers({
          subject: context.get("subject"),
          query: context.req.valid("query"),
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    createScimUserRoute,
    async (context) =>
      scimRoute(
        context,
        async () =>
          context.get("services").scim.createUser({
            subject: context.get("subject"),
            body: context.req.valid("json"),
            baseUrl: baseUrl(context),
          }),
        201,
      ),
    scimValidationHook,
  );

  app.openapi(
    getScimUserRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.getUser({
          subject: context.get("subject"),
          userId: context.req.valid("param").userId,
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    replaceScimUserRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.replaceUser({
          subject: context.get("subject"),
          userId: context.req.valid("param").userId,
          body: context.req.valid("json"),
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    patchScimUserRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.patchUser({
          subject: context.get("subject"),
          userId: context.req.valid("param").userId,
          body: context.req.valid("json"),
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    deleteScimUserRoute,
    async (context) =>
      scimRoute(context, async () => {
        await context.get("services").scim.deleteUser({
          subject: context.get("subject"),
          userId: context.req.valid("param").userId,
        });
        return undefined;
      }),
    scimValidationHook,
  );

  app.openapi(
    listScimGroupsRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.listGroups({
          subject: context.get("subject"),
          query: context.req.valid("query"),
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    createScimGroupRoute,
    async (context) =>
      scimRoute(
        context,
        async () =>
          context.get("services").scim.createGroup({
            subject: context.get("subject"),
            body: context.req.valid("json"),
            baseUrl: baseUrl(context),
          }),
        201,
      ),
    scimValidationHook,
  );

  app.openapi(
    getScimGroupRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.getGroup({
          subject: context.get("subject"),
          groupId: context.req.valid("param").groupId,
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    replaceScimGroupRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.replaceGroup({
          subject: context.get("subject"),
          groupId: context.req.valid("param").groupId,
          body: context.req.valid("json"),
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    patchScimGroupRoute,
    async (context) =>
      scimRoute(context, async () =>
        context.get("services").scim.patchGroup({
          subject: context.get("subject"),
          groupId: context.req.valid("param").groupId,
          body: context.req.valid("json"),
          baseUrl: baseUrl(context),
        }),
      ),
    scimValidationHook,
  );

  app.openapi(
    deleteScimGroupRoute,
    async (context) =>
      scimRoute(context, async () => {
        await context.get("services").scim.deleteGroup({
          subject: context.get("subject"),
          groupId: context.req.valid("param").groupId,
        });
        return undefined;
      }),
    scimValidationHook,
  );
}

function scimValidationHook(result: { success: boolean }): never | undefined {
  if (result.success) return undefined;
  return scimJson(
    scimErrorBody("The SCIM request payload is invalid.", 400, "invalidSyntax"),
    400,
  ) as never;
}

async function scimRoute(
  context: Context<AppBindings>,
  work: () => Promise<unknown> | unknown,
  status = 200,
): Promise<never> {
  try {
    const body = await work();
    if (body === undefined) return new Response(null, { status: 204 }) as never;
    return scimJson(body, status) as never;
  } catch (error) {
    if (error instanceof ApiError) {
      return scimJson(
        scimErrorBody(error.message, error.status, error.details.scimType),
        error.status,
      ) as never;
    }
    if (error instanceof AuthorizationError) {
      return scimJson(scimErrorBody(error.message, 403), 403) as never;
    }
    if (error instanceof ZodError) {
      return scimJson(
        scimErrorBody(
          "The SCIM request payload is invalid.",
          400,
          "invalidSyntax",
        ),
        400,
      ) as never;
    }
    throw error;
  }
}

function scimJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/scim+json; charset=utf-8" },
  });
}

function scimErrorBody(
  detail: string,
  status: number,
  scimType?: unknown,
): Record<string, unknown> {
  return {
    schemas: [scimErrorSchema],
    detail,
    status: String(status),
    ...(typeof scimType === "string" && scimType.length > 0
      ? { scimType }
      : {}),
  };
}

function baseUrl(context: Context<AppBindings>): string {
  const url = new URL(context.req.url);
  return `${url.protocol}//${url.host}`;
}
