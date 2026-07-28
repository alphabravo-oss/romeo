import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  errorResponse,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export const UserSessionSchema = z
  .strictObject({
    id: z.string(),
    orgId: z.string(),
    userId: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    isAdmin: z.boolean(),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
    lastSeenAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
  })
  .openapi("UserSession");

export const SessionTokenSchema = z
  .string()
  .regex(/^rms_[a-f0-9]{48}$/)
  .openapi({
    description:
      "Bearer session token returned once and also set in an HttpOnly cookie.",
  });

export const CreatedUserSessionSchema = z
  .strictObject({ session: UserSessionSchema, token: SessionTokenSchema })
  .openapi("CreatedUserSession");

export const CreateSessionSchema = z
  .strictObject({
    name: z.string().min(1).max(120).default("Local session"),
    ttlHours: z.number().int().min(1).max(720).optional(),
  })
  .openapi("CreateSessionRequest");

export const SessionIdParamsSchema = z
  .strictObject({ sessionId: z.string().min(1).max(160) })
  .openapi("SessionIdParams");

export const UserSessionResponseSchema = dataEnvelope(
  UserSessionSchema,
).openapi("UserSessionResponse");
export const UserSessionsResponseSchema = dataEnvelope(
  z.array(UserSessionSchema),
).openapi("UserSessionsResponse");
export const CreatedUserSessionResponseSchema = dataEnvelope(
  CreatedUserSessionSchema,
).openapi("CreatedUserSessionResponse");

export const SupportSessionReportSchema = z
  .strictObject({
    session: UserSessionSchema,
    status: z.enum(["active", "expired", "revoked"]),
    adminUserId: z.string(),
    targetUserId: z.string(),
    approvalRequestId: z.string().optional(),
    requestedByUserId: z.string().optional(),
    ttlMinutes: z.number().int().min(5).max(60).optional(),
    ticketRef: z.string().optional(),
    reasonHash: z.string().optional(),
    reasonLength: z.number().int().nonnegative().optional(),
    createdAuditLogId: z.string(),
  })
  .openapi("SupportSessionReport");

export const SupportSessionRequestReportSchema = z
  .strictObject({
    id: z.string(),
    status: z.enum(["approved", "pending", "rejected"]),
    requestedByUserId: z.string(),
    targetUserId: z.string(),
    ttlMinutes: z.number().int().min(5).max(60),
    createdAt: z.iso.datetime(),
    approvedAt: z.iso.datetime().optional(),
    approvedByUserId: z.string().optional(),
    rejectedAt: z.iso.datetime().optional(),
    rejectedByUserId: z.string().optional(),
    sessionId: z.string().optional(),
    ticketRef: z.string().optional(),
    reasonHash: z.string().optional(),
    reasonLength: z.number().int().nonnegative().optional(),
  })
  .openapi("SupportSessionRequestReport");

export const CreateSupportSessionSchema = z
  .strictObject({
    targetUserId: z.string().min(1).max(120),
    confirmTargetUserId: z.string().min(1).max(120),
    reason: z.string().min(10).max(500),
    ticketRef: z.string().min(1).max(200).optional(),
    ttlMinutes: z.number().int().min(5).max(60).optional(),
  })
  .openapi("CreateSupportSessionRequest");

export const SupportSessionReportsResponseSchema = dataEnvelope(
  z.array(SupportSessionReportSchema),
).openapi("SupportSessionReportsResponse");
export const SupportSessionReportResponseSchema = dataEnvelope(
  SupportSessionReportSchema,
).openapi("SupportSessionReportResponse");
export const SupportSessionRequestReportsResponseSchema = dataEnvelope(
  z.array(SupportSessionRequestReportSchema),
).openapi("SupportSessionRequestReportsResponse");
export const SupportSessionRequestReportResponseSchema = dataEnvelope(
  SupportSessionRequestReportSchema,
).openapi("SupportSessionRequestReportResponse");

export const SupportSessionIdParamsSchema = z
  .strictObject({ sessionId: z.string().min(1).max(160) })
  .openapi("SupportSessionIdParams");
export const SupportSessionRequestIdParamsSchema = z
  .strictObject({ requestId: z.string().min(1).max(160) })
  .openapi("SupportSessionRequestIdParams");

export const listSessionsRoute = createRoute({
  method: "get",
  path: "/api/v1/sessions",
  operationId: "sessions.listCurrentUser",
  tags: ["Sessions"],
  summary: "List sessions for the current user",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse("Current user sessions", UserSessionsResponseSchema),
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});

export const createSessionRoute = createRoute({
  method: "post",
  path: "/api/v1/sessions",
  operationId: "sessions.createCurrentUser",
  tags: ["Sessions"],
  summary: "Create a session for the current user",
  description:
    "Creates a revocable session and sets the token in an HttpOnly cookie.",
  security: authenticationSecurity,
  request: {
    body: {
      required: false,
      content: { "application/json": { schema: CreateSessionSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created session", CreatedUserSessionResponseSchema),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});

export const revokeCurrentSessionRoute = createRoute({
  method: "delete",
  path: "/api/v1/sessions/current",
  operationId: "sessions.revokeCurrent",
  tags: ["Sessions"],
  summary: "Revoke the current session",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse("Revoked session", UserSessionResponseSchema),
    401: standardErrorResponses[401],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});

export const revokeOtherSessionsRoute = createRoute({
  method: "post",
  path: "/api/v1/sessions/revoke-others",
  operationId: "sessions.revokeOthers",
  tags: ["Sessions"],
  summary: "Revoke all other current-user sessions",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse("Revoked sessions", UserSessionsResponseSchema),
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});

export const revokeSessionRoute = createRoute({
  method: "delete",
  path: "/api/v1/sessions/{sessionId}",
  operationId: "sessions.revokeById",
  tags: ["Sessions"],
  summary: "Revoke a session by ID",
  security: authenticationSecurity,
  request: { params: SessionIdParamsSchema },
  responses: {
    200: jsonResponse("Revoked session", UserSessionResponseSchema),
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});

export const listSupportSessionsRoute = createRoute({
  method: "get",
  path: "/api/v1/admin/impersonation/sessions",
  operationId: "impersonation.listSessions",
  tags: ["Impersonation"],
  summary: "List audited support impersonation sessions",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse(
      "Support session reports",
      SupportSessionReportsResponseSchema,
    ),
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    500: standardErrorResponses[500],
  },
});

export const createSupportSessionRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/impersonation/sessions",
  operationId: "impersonation.createSession",
  tags: ["Impersonation"],
  summary: "Create an audited support impersonation session",
  security: authenticationSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateSupportSessionSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Created support session",
      CreatedUserSessionResponseSchema,
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    500: standardErrorResponses[500],
  },
});

export const revokeSupportSessionRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/impersonation/sessions/{sessionId}/revoke",
  operationId: "impersonation.revokeSession",
  tags: ["Impersonation"],
  summary: "Revoke an audited support impersonation session",
  security: authenticationSecurity,
  request: { params: SupportSessionIdParamsSchema },
  responses: {
    200: jsonResponse(
      "Support session report",
      SupportSessionReportResponseSchema,
    ),
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    404: standardErrorResponses[404],
    500: standardErrorResponses[500],
  },
});

export const listSupportSessionRequestsRoute = createRoute({
  method: "get",
  path: "/api/v1/admin/impersonation/requests",
  operationId: "impersonation.listRequests",
  tags: ["Impersonation"],
  summary: "List support impersonation approval requests",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse(
      "Support impersonation requests",
      SupportSessionRequestReportsResponseSchema,
    ),
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    500: standardErrorResponses[500],
  },
});

export const createSupportSessionRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/impersonation/requests",
  operationId: "impersonation.createRequest",
  tags: ["Impersonation"],
  summary: "Create a support impersonation approval request",
  security: authenticationSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateSupportSessionSchema } },
    },
  },
  responses: {
    201: jsonResponse(
      "Support impersonation request",
      SupportSessionRequestReportResponseSchema,
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    500: standardErrorResponses[500],
  },
});

export const approveSupportSessionRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/impersonation/requests/{requestId}/approve",
  operationId: "impersonation.approveRequest",
  tags: ["Impersonation"],
  summary: "Approve a support impersonation request",
  security: authenticationSecurity,
  request: { params: SupportSessionRequestIdParamsSchema },
  responses: {
    201: jsonResponse(
      "Created support session",
      CreatedUserSessionResponseSchema,
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    409: standardErrorResponses[409],
    500: standardErrorResponses[500],
  },
});

export const rejectSupportSessionRequestRoute = createRoute({
  method: "post",
  path: "/api/v1/admin/impersonation/requests/{requestId}/reject",
  operationId: "impersonation.rejectRequest",
  tags: ["Impersonation"],
  summary: "Reject a support impersonation request",
  security: authenticationSecurity,
  request: { params: SupportSessionRequestIdParamsSchema },
  responses: {
    200: jsonResponse(
      "Support impersonation request",
      SupportSessionRequestReportResponseSchema,
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    403: standardErrorResponses[403],
    409: standardErrorResponses[409],
    500: standardErrorResponses[500],
  },
});

export const LocalLoginSchema = z
  .strictObject({
    email: z.email().max(320),
    orgId: z.string().min(1).max(120).optional(),
    password: z.string().min(1).max(256),
    recoveryCode: z
      .string()
      .regex(/^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/)
      .optional(),
    totpCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine(
    (value) => value.totpCode === undefined || value.recoveryCode === undefined,
    { message: "Provide one MFA method." },
  )
  .openapi("LocalLoginRequest");

export const LocalAuthenticatedLoginResultSchema = z
  .strictObject({
    status: z.literal("authenticated"),
    session: UserSessionSchema,
    token: SessionTokenSchema,
  })
  .openapi("LocalAuthenticatedLoginResult");

export const LocalMfaChallengeResultSchema = z
  .strictObject({
    status: z.literal("mfa_required"),
    challengeToken: z.string().max(4_000),
    expiresAt: z.iso.datetime(),
    methods: z.array(z.enum(["recovery_code", "totp"])).min(1),
  })
  .openapi("LocalMfaChallengeResult");

export const LocalLoginResultSchema = z
  .discriminatedUnion("status", [
    LocalAuthenticatedLoginResultSchema,
    LocalMfaChallengeResultSchema,
  ])
  .openapi("LocalLoginResult");

export const LocalLoginResponseSchema = dataEnvelope(
  LocalLoginResultSchema,
).openapi("LocalLoginResponse");

export const LocalMfaVerifySchema = z
  .strictObject({
    challengeToken: z.string().min(1).max(4_000),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z
      .string()
      .regex(/^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/)
      .optional(),
  })
  .refine(
    (value) =>
      (value.code === undefined) !== (value.recoveryCode === undefined),
    { message: "Provide exactly one MFA method." },
  )
  .openapi("LocalMfaVerifyRequest");

export const LocalAuthenticatedLoginResponseSchema = dataEnvelope(
  LocalAuthenticatedLoginResultSchema,
).openapi("LocalAuthenticatedLoginResponse");

export const localLoginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/login",
  operationId: "authentication.loginLocal",
  tags: ["Authentication"],
  summary: "Authenticate with local credentials",
  description:
    "Authenticates an email and password, optionally completes MFA, and sets an HttpOnly session cookie on success.",
  security: [],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: LocalLoginSchema } },
    },
  },
  responses: {
    200: jsonResponse("Local login result", LocalLoginResponseSchema),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    423: errorResponse,
    500: standardErrorResponses[500],
  },
});

export const verifyLocalMfaRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/mfa/verify",
  operationId: "authentication.verifyLocalMfa",
  tags: ["Authentication"],
  summary: "Complete a local MFA challenge",
  description:
    "Completes a pending local login using exactly one TOTP or recovery code and sets an HttpOnly session cookie.",
  security: [],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: LocalMfaVerifySchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Authenticated local session",
      LocalAuthenticatedLoginResponseSchema,
    ),
    400: standardErrorResponses[400],
    401: standardErrorResponses[401],
    500: standardErrorResponses[500],
  },
});
