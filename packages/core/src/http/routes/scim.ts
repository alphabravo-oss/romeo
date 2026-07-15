import { AuthorizationError } from "@romeo/auth";
import type { Context } from "hono";
import { ZodError } from "zod";

import { ApiError } from "../../errors";
import { scimErrorSchema } from "../../services/scim-resource";
import type { AppBindings, RomeoApi } from "../context";
import {
  scimGroupBodySchema,
  scimListQuerySchema,
  scimPatchBodySchema,
  scimUserBodySchema,
} from "../scim-schemas";

export function registerScimRoutes(app: RomeoApi): void {
  app.get("/api/v1/scim/v2/ServiceProviderConfig", async (context) =>
    scimRoute(context, async () =>
      context
        .get("services")
        .scim.serviceProviderConfig(context.get("subject"), baseUrl(context)),
    ),
  );

  app.get("/api/v1/scim/v2/Schemas", async (context) =>
    scimRoute(context, async () =>
      context
        .get("services")
        .scim.schemas(context.get("subject"), baseUrl(context)),
    ),
  );

  app.get("/api/v1/scim/v2/ResourceTypes", async (context) =>
    scimRoute(context, async () =>
      context
        .get("services")
        .scim.resourceTypes(context.get("subject"), baseUrl(context)),
    ),
  );

  app.get("/api/v1/scim/v2/Users", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.listUsers({
        subject: context.get("subject"),
        query: scimListQuerySchema.parse(context.req.query()),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.post("/api/v1/scim/v2/Users", async (context) =>
    scimRoute(
      context,
      async () =>
        context.get("services").scim.createUser({
          subject: context.get("subject"),
          body: scimUserBodySchema.parse(await context.req.json()),
          baseUrl: baseUrl(context),
        }),
      201,
    ),
  );

  app.get("/api/v1/scim/v2/Users/:userId", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.getUser({
        subject: context.get("subject"),
        userId: context.req.param("userId"),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.put("/api/v1/scim/v2/Users/:userId", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.replaceUser({
        subject: context.get("subject"),
        userId: context.req.param("userId"),
        body: scimUserBodySchema.parse(await context.req.json()),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.patch("/api/v1/scim/v2/Users/:userId", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.patchUser({
        subject: context.get("subject"),
        userId: context.req.param("userId"),
        body: scimPatchBodySchema.parse(await context.req.json()),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.delete("/api/v1/scim/v2/Users/:userId", async (context) =>
    scimRoute(context, async () => {
      await context.get("services").scim.deleteUser({
        subject: context.get("subject"),
        userId: context.req.param("userId"),
      });
      return undefined;
    }),
  );

  app.get("/api/v1/scim/v2/Groups", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.listGroups({
        subject: context.get("subject"),
        query: scimListQuerySchema.parse(context.req.query()),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.post("/api/v1/scim/v2/Groups", async (context) =>
    scimRoute(
      context,
      async () =>
        context.get("services").scim.createGroup({
          subject: context.get("subject"),
          body: scimGroupBodySchema.parse(await context.req.json()),
          baseUrl: baseUrl(context),
        }),
      201,
    ),
  );

  app.get("/api/v1/scim/v2/Groups/:groupId", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.getGroup({
        subject: context.get("subject"),
        groupId: context.req.param("groupId"),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.put("/api/v1/scim/v2/Groups/:groupId", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.replaceGroup({
        subject: context.get("subject"),
        groupId: context.req.param("groupId"),
        body: scimGroupBodySchema.parse(await context.req.json()),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.patch("/api/v1/scim/v2/Groups/:groupId", async (context) =>
    scimRoute(context, async () =>
      context.get("services").scim.patchGroup({
        subject: context.get("subject"),
        groupId: context.req.param("groupId"),
        body: scimPatchBodySchema.parse(await context.req.json()),
        baseUrl: baseUrl(context),
      }),
    ),
  );

  app.delete("/api/v1/scim/v2/Groups/:groupId", async (context) =>
    scimRoute(context, async () => {
      await context.get("services").scim.deleteGroup({
        subject: context.get("subject"),
        groupId: context.req.param("groupId"),
      });
      return undefined;
    }),
  );
}

async function scimRoute(
  context: Context<AppBindings>,
  work: () => Promise<unknown> | unknown,
  status = 200,
): Promise<Response> {
  try {
    const body = await work();
    if (body === undefined) return new Response(null, { status: 204 });
    return scimJson(body, status);
  } catch (error) {
    if (error instanceof ApiError) {
      return scimJson(
        scimErrorBody(error.message, error.status, error.details.scimType),
        error.status,
      );
    }
    if (error instanceof AuthorizationError) {
      return scimJson(scimErrorBody(error.message, 403), 403);
    }
    if (error instanceof ZodError) {
      return scimJson(
        scimErrorBody(
          "The SCIM request payload is invalid.",
          400,
          "invalidSyntax",
        ),
        400,
      );
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
