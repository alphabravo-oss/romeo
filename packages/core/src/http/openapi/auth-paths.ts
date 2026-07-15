import { created, errorResponse, success } from "./helpers";

export const authPaths = {
  "/auth/local/login": {
    post: {
      summary:
        "Authenticate with local email/password and optional local MFA code",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LocalLoginRequest" },
          },
        },
      },
      responses: {
        200: success("Local login result", {
          $ref: "#/components/schemas/LocalLoginResult",
        }),
        401: errorResponse,
        423: errorResponse,
      },
    },
  },
  "/auth/ldap/login": {
    post: {
      summary: "Authenticate with LDAP or Active Directory bind/search",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LdapLoginRequest" },
          },
        },
      },
      responses: {
        200: success("Authenticated LDAP session", {
          $ref: "#/components/schemas/LdapLoginResult",
        }),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
        502: errorResponse,
      },
    },
  },
  "/auth/local/mfa/verify": {
    post: {
      summary: "Complete local login after MFA challenge",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LocalMfaVerifyRequest" },
          },
        },
      },
      responses: {
        200: success("Authenticated local session", {
          $ref: "#/components/schemas/LocalMfaVerifyResult",
        }),
        401: errorResponse,
      },
    },
  },
  "/auth/local/status": {
    get: {
      summary: "Inspect current user local password and MFA status",
      responses: {
        200: success("Local auth status", {
          $ref: "#/components/schemas/LocalAuthStatus",
        }),
        403: errorResponse,
      },
    },
  },
  "/auth/local/password": {
    post: {
      summary: "Set or change the current user local password",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SetLocalPasswordRequest" },
          },
        },
      },
      responses: {
        200: success("Local auth status", {
          $ref: "#/components/schemas/LocalAuthStatus",
        }),
        400: errorResponse,
        401: errorResponse,
      },
    },
  },
  "/auth/local/mfa/totp/enroll": {
    post: {
      summary: "Start current user TOTP MFA enrollment",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/TotpEnrollmentRequest" },
          },
        },
      },
      responses: {
        201: created("TOTP enrollment secret", {
          $ref: "#/components/schemas/TotpEnrollment",
        }),
        409: errorResponse,
      },
    },
  },
  "/auth/local/mfa/totp/confirm": {
    post: {
      summary: "Confirm current user TOTP MFA enrollment",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/TotpConfirmRequest" },
          },
        },
      },
      responses: {
        200: success("Local MFA factor", {
          $ref: "#/components/schemas/LocalMfaFactorSummary",
        }),
        401: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/local/mfa/recovery-codes/generate": {
    post: {
      summary: "Generate one-time local MFA recovery codes",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/RecoveryCodesGenerateRequest",
            },
          },
        },
      },
      responses: {
        201: created("One-time MFA recovery codes", {
          $ref: "#/components/schemas/LocalMfaRecoveryCodes",
        }),
        401: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/local/mfa/factors/{factorId}/disable": {
    post: {
      summary: "Disable a current user local MFA factor",
      parameters: [
        {
          name: "factorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/TotpDisableRequest" },
          },
        },
      },
      responses: {
        200: success("Local MFA factor", {
          $ref: "#/components/schemas/LocalMfaFactorSummary",
        }),
        401: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/auth/oidc/start": {
    get: {
      summary: "Start browser OIDC login with PKCE",
      parameters: [
        {
          name: "returnTo",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "providerId",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: [
              "generic-oidc",
              "keycloak",
              "google",
              "azure-ad",
              "okta",
              "auth0",
            ],
          },
        },
        {
          name: "orgId",
          in: "query",
          required: false,
          schema: { type: "string", maxLength: 120 },
        },
      ],
      responses: {
        200: success("OIDC authorization redirect URL", {
          type: "object",
          required: ["authorizationUrl", "expiresAt", "orgId"],
          additionalProperties: false,
          properties: {
            authorizationUrl: { type: "string", format: "uri" },
            expiresAt: { type: "string", format: "date-time" },
            orgId: { type: "string" },
            providerId: {
              type: "string",
              enum: [
                "generic-oidc",
                "keycloak",
                "google",
                "azure-ad",
                "okta",
                "auth0",
              ],
            },
          },
        }),
        400: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/oidc/callback": {
    get: {
      summary: "Complete browser OIDC login with PKCE",
      parameters: [
        {
          name: "code",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "state",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        302: {
          description:
            "Redirects to the signed return path and sets the local session cookie",
        },
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/oauth2/start": {
    get: {
      summary: "Start browser OAuth2 login with PKCE",
      parameters: [
        {
          name: "providerId",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["github"] },
        },
        {
          name: "returnTo",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "orgId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("OAuth2 authorization redirect URL", {
          $ref: "#/components/schemas/OAuth2PkceStartResult",
        }),
        400: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/oauth2/callback": {
    get: {
      summary: "Complete browser OAuth2 login with PKCE",
      parameters: [
        {
          name: "code",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "state",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        302: {
          description:
            "Redirects to the signed return path and sets the local session cookie",
        },
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/saml/start": {
    get: {
      summary: "Start browser SAML login",
      parameters: [
        {
          name: "providerId",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["saml"] },
        },
        {
          name: "returnTo",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "orgId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("SAML authorization redirect URL", {
          $ref: "#/components/schemas/SamlStartResult",
        }),
        400: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/saml/callback": {
    post: {
      summary: "Complete browser SAML login through HTTP-POST ACS",
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              required: ["SAMLResponse"],
              properties: {
                SAMLResponse: { type: "string" },
                RelayState: { type: "string" },
              },
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        302: {
          description:
            "Redirects to the signed return path and sets the local session cookie",
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/auth/saml/metadata": {
    get: {
      summary: "Return SAML service-provider metadata XML",
      parameters: [
        {
          name: "providerId",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["saml"] },
        },
        {
          name: "orgId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "SAML service-provider metadata XML",
          content: {
            "application/samlmetadata+xml": {
              schema: { type: "string" },
            },
          },
        },
        400: errorResponse,
        409: errorResponse,
      },
    },
  },
};
