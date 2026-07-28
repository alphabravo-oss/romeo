import { createRoute, z } from "@hono/zod-openapi";

import {
  LocalAuthStatusSchema,
  LocalMfaFactorSummarySchema,
} from "./administration";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
import { SessionTokenSchema, UserSessionSchema } from "./sessions";

const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const tags = ["Local authentication"];

export const LdapLoginRequestSchema = z
  .strictObject({
    identifier: z.string().trim().min(1).max(320),
    orgId: z.string().min(1).max(120).optional(),
    password: z.string().min(1).max(256),
    providerId: z.enum(["ldap", "active-directory"]),
  })
  .openapi("LdapLoginRequest");
export const LdapLoginResultSchema = z
  .strictObject({
    status: z.literal("authenticated"),
    session: UserSessionSchema,
    token: SessionTokenSchema,
  })
  .openapi("LdapLoginResult");
export const SetLocalPasswordRequestSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(256).optional(),
    newPassword: z.string().min(12).max(256),
  })
  .openapi("SetLocalPasswordRequest");
export const TotpEnrollmentRequestSchema = z
  .strictObject({ name: z.string().min(1).max(120).optional() })
  .openapi("TotpEnrollmentRequest");
export const TotpConfirmRequestSchema = z
  .strictObject({
    factorId: z.string().min(1).max(120),
    code: z.string().regex(/^\d{6}$/u),
  })
  .openapi("TotpConfirmRequest");
export const RecoveryCodesGenerateRequestSchema = z
  .strictObject({ totpCode: z.string().regex(/^\d{6}$/u) })
  .openapi("RecoveryCodesGenerateRequest");
export const TotpDisableRequestSchema = z
  .strictObject({
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
  })
  .openapi("TotpDisableRequest");
export const TotpFactorParamsSchema = z.strictObject({
  factorId: z.string().min(1).max(120),
});
export const TotpEnrollmentSchema = z
  .strictObject({
    factor: LocalMfaFactorSummarySchema,
    otpauthUri: z.string(),
    secret: z.string().min(1),
  })
  .openapi("TotpEnrollment");
export const LocalMfaRecoveryCodesSchema = z
  .strictObject({
    factor: LocalMfaFactorSummarySchema,
    codes: z
      .array(z.string().regex(/^rmfa-[a-f0-9]{4}(?:-[a-f0-9]{4}){3}$/u))
      .length(10),
    recoveryCodeRemainingCount: z.number().int().nonnegative(),
  })
  .openapi("LocalMfaRecoveryCodes");

export const ldapLoginRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/ldap/login",
  operationId: "localAuth.loginLdap",
  tags,
  summary: "Authenticate with LDAP or Active Directory",
  security: [],
  request: { body: body(LdapLoginRequestSchema) },
  responses: {
    200: jsonResponse(
      "Authenticated LDAP session",
      dataEnvelope(LdapLoginResultSchema),
    ),
    ...standardErrorResponses,
  },
});
export const getLocalAuthStatusRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/local/status",
  operationId: "localAuth.getStatus",
  tags,
  summary: "Get current-user password and MFA status",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse("Local auth status", dataEnvelope(LocalAuthStatusSchema)),
    ...standardErrorResponses,
  },
});
export const setLocalPasswordRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/password",
  operationId: "localAuth.setPassword",
  tags,
  summary: "Set or change the current-user password",
  security: authenticationSecurity,
  request: { body: body(SetLocalPasswordRequestSchema) },
  responses: {
    200: jsonResponse("Local auth status", dataEnvelope(LocalAuthStatusSchema)),
    ...standardErrorResponses,
  },
});
export const startTotpEnrollmentRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/mfa/totp/enroll",
  operationId: "localAuth.startTotpEnrollment",
  tags,
  summary: "Start TOTP enrollment",
  security: authenticationSecurity,
  request: { body: body(TotpEnrollmentRequestSchema) },
  responses: {
    201: jsonResponse("TOTP enrollment", dataEnvelope(TotpEnrollmentSchema)),
    ...standardErrorResponses,
  },
});
export const confirmTotpEnrollmentRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/mfa/totp/confirm",
  operationId: "localAuth.confirmTotpEnrollment",
  tags,
  summary: "Confirm TOTP enrollment",
  security: authenticationSecurity,
  request: { body: body(TotpConfirmRequestSchema) },
  responses: {
    200: jsonResponse(
      "Local MFA factor",
      dataEnvelope(LocalMfaFactorSummarySchema),
    ),
    ...standardErrorResponses,
  },
});
export const generateRecoveryCodesRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/mfa/recovery-codes/generate",
  operationId: "localAuth.generateRecoveryCodes",
  tags,
  summary: "Generate one-time MFA recovery codes",
  security: authenticationSecurity,
  request: { body: body(RecoveryCodesGenerateRequestSchema) },
  responses: {
    201: jsonResponse(
      "One-time recovery codes",
      dataEnvelope(LocalMfaRecoveryCodesSchema),
    ),
    ...standardErrorResponses,
  },
});
export const disableTotpFactorRoute = createRoute({
  method: "post",
  path: "/api/v1/auth/local/mfa/factors/{factorId}/disable",
  operationId: "localAuth.disableTotpFactor",
  tags,
  summary: "Disable a current-user MFA factor",
  security: authenticationSecurity,
  request: {
    params: TotpFactorParamsSchema,
    body: body(TotpDisableRequestSchema),
  },
  responses: {
    200: jsonResponse(
      "Disabled local MFA factor",
      dataEnvelope(LocalMfaFactorSummarySchema),
    ),
    ...standardErrorResponses,
  },
});

export const localAuthRoutes = [
  ldapLoginRoute,
  getLocalAuthStatusRoute,
  setLocalPasswordRoute,
  startTotpEnrollmentRoute,
  confirmTotpEnrollmentRoute,
  generateRecoveryCodesRoute,
  disableTotpFactorRoute,
] as const;
