import { scopeValues } from "@romeo/auth";

const dateTime = { type: "string", format: "date-time" };
const nonNegativeInteger = { type: "integer", minimum: 0 };
const recoveryCode = {
  type: "string",
  pattern: "^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$",
};
const sessionToken = {
  type: "string",
  pattern: "^rms_[a-f0-9]{48}$",
  description:
    "Bearer session token returned once and also set as an HttpOnly cookie on browser login/session creation routes.",
};

export const sessionAuthSchemas = {
  UserSession: {
    type: "object",
    description:
      "Sanitized local user session metadata. Token hashes are never returned.",
    required: [
      "id",
      "orgId",
      "userId",
      "name",
      "scopes",
      "isAdmin",
      "expiresAt",
      "createdAt",
    ],
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      orgId: { type: "string" },
      userId: { type: "string" },
      name: { type: "string" },
      scopes: {
        type: "array",
        items: { type: "string", enum: scopeValues },
      },
      isAdmin: { type: "boolean" },
      expiresAt: dateTime,
      revokedAt: dateTime,
      lastSeenAt: dateTime,
      createdAt: dateTime,
    },
  },
  CreatedUserSession: {
    type: "object",
    description:
      "Created authenticated session. The token is returned once and must not be logged.",
    required: ["session", "token"],
    additionalProperties: false,
    properties: {
      session: { $ref: "#/components/schemas/UserSession" },
      token: sessionToken,
    },
  },
  LocalAuthenticatedLoginResult: {
    type: "object",
    required: ["status", "session", "token"],
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["authenticated"] },
      session: { $ref: "#/components/schemas/UserSession" },
      token: sessionToken,
    },
  },
  LocalMfaChallengeResult: {
    type: "object",
    required: ["status", "challengeToken", "expiresAt", "methods"],
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["mfa_required"] },
      challengeToken: {
        type: "string",
        maxLength: 4000,
        description:
          "Short-lived signed MFA challenge token used only with the MFA verify route.",
      },
      expiresAt: dateTime,
      methods: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: ["recovery_code", "totp"] },
      },
    },
  },
  LocalLoginResult: {
    oneOf: [
      { $ref: "#/components/schemas/LocalAuthenticatedLoginResult" },
      { $ref: "#/components/schemas/LocalMfaChallengeResult" },
    ],
  },
  LocalMfaVerifyResult: {
    $ref: "#/components/schemas/LocalAuthenticatedLoginResult",
  },
  LocalMfaFactorSummary: {
    type: "object",
    required: ["id", "type", "name", "status", "createdAt"],
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["recovery_codes", "totp"] },
      name: { type: "string" },
      status: { type: "string", enum: ["active", "disabled", "pending"] },
      createdAt: dateTime,
      confirmedAt: dateTime,
      disabledAt: dateTime,
      lastUsedAt: dateTime,
      recoveryCodeRemainingCount: nonNegativeInteger,
    },
  },
  LocalAuthStatus: {
    type: "object",
    required: ["hasPassword", "mfaEnabled", "role", "factors"],
    additionalProperties: false,
    properties: {
      hasPassword: { type: "boolean" },
      mfaEnabled: { type: "boolean" },
      role: { type: "string", enum: ["global_admin", "org_admin", "user"] },
      factors: {
        type: "array",
        items: { $ref: "#/components/schemas/LocalMfaFactorSummary" },
      },
    },
  },
  TotpEnrollment: {
    type: "object",
    required: ["factor", "otpauthUri", "secret"],
    additionalProperties: false,
    properties: {
      factor: { $ref: "#/components/schemas/LocalMfaFactorSummary" },
      otpauthUri: {
        type: "string",
        description:
          "otpauth URI for authenticator app enrollment. Returned only during enrollment.",
      },
      secret: {
        type: "string",
        description:
          "Plaintext TOTP enrollment secret. Returned only during enrollment and stored encrypted server-side.",
      },
    },
  },
  LocalMfaRecoveryCodes: {
    type: "object",
    required: ["factor", "codes", "recoveryCodeRemainingCount"],
    additionalProperties: false,
    properties: {
      factor: { $ref: "#/components/schemas/LocalMfaFactorSummary" },
      codes: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: recoveryCode,
        description:
          "One-time recovery codes returned only when generated. Server stores only salted hashes.",
      },
      recoveryCodeRemainingCount: nonNegativeInteger,
    },
  },
  SupportSessionReport: {
    type: "object",
    required: [
      "adminUserId",
      "createdAuditLogId",
      "session",
      "status",
      "targetUserId",
    ],
    additionalProperties: false,
    properties: {
      adminUserId: { type: "string" },
      approvalRequestId: { type: "string" },
      createdAuditLogId: { type: "string" },
      reasonHash: { type: "string" },
      reasonLength: nonNegativeInteger,
      requestedByUserId: { type: "string" },
      session: { $ref: "#/components/schemas/UserSession" },
      status: { type: "string", enum: ["active", "expired", "revoked"] },
      targetUserId: { type: "string" },
      ticketRef: { type: "string" },
      ttlMinutes: { type: "integer", minimum: 5, maximum: 60 },
    },
  },
  SupportSessionRequestReport: {
    type: "object",
    required: [
      "id",
      "status",
      "requestedByUserId",
      "targetUserId",
      "ttlMinutes",
      "createdAt",
    ],
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["approved", "pending", "rejected"] },
      requestedByUserId: { type: "string" },
      targetUserId: { type: "string" },
      ttlMinutes: { type: "integer", minimum: 5, maximum: 60 },
      createdAt: dateTime,
      approvedAt: dateTime,
      approvedByUserId: { type: "string" },
      rejectedAt: dateTime,
      rejectedByUserId: { type: "string" },
      sessionId: { type: "string" },
      ticketRef: { type: "string" },
      reasonHash: { type: "string" },
      reasonLength: nonNegativeInteger,
    },
  },
};
