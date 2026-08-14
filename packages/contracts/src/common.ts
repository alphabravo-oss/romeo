import { z } from "@hono/zod-openapi";

export const ApiErrorSchema = z
  .strictObject({
    error: z.strictObject({
      code: z.string(),
      message: z.string(),
      request_id: z.string(),
      details: z.record(z.string(), z.unknown()),
    }),
  })
  .openapi("ApiError");

export const authenticationSecurity = [
  { bearerAuth: [] as string[] },
  { sessionCookie: [] as string[] },
];

export const securitySchemes = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "API key or OIDC access token",
    description: "Romeo API key or compact OIDC JWT.",
  },
  sessionCookie: {
    type: "apiKey",
    in: "cookie",
    name: "romeo_session",
    description: "HTTP-only Romeo browser session cookie.",
  },
} as const;

export function dataEnvelope<T extends z.ZodType>(schema: T) {
  return z.strictObject({ data: schema });
}

export function jsonResponse<T extends z.ZodType>(
  description: string,
  schema: T,
) {
  return {
    description,
    content: { "application/json": { schema } },
  } as const;
}

export const IdempotencyKeyHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .openapi("IdempotencyKey");

export const optionalIdempotencyHeaders = z.object({
  "idempotency-key": IdempotencyKeyHeaderSchema.optional(),
});

export function idempotentJsonResponse<T extends z.ZodType>(
  description: string,
  schema: T,
) {
  return {
    ...jsonResponse(description, schema),
    headers: {
      "Idempotency-Replayed": {
        description:
          "True when the response was replayed from a durable receipt.",
        schema: { type: "boolean" as const },
      },
      "Idempotency-Receipt-Expires-At": {
        description: "Expiry of the durable receipt in ISO 8601 form.",
        schema: { type: "string" as const, format: "date-time" },
      },
    },
  } as const;
}

export const errorResponse = jsonResponse(
  "Stable Romeo API error response",
  ApiErrorSchema,
);

export const standardErrorResponses = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  429: errorResponse,
  500: errorResponse,
} as const;
