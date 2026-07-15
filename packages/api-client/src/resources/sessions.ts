import type { RomeoTransport } from "../transport";
import type {
  CreatedUserSession,
  CreateSessionInput,
  CreateSupportSessionInput,
  GenerateRecoveryCodesInput,
  LdapLoginInput,
  LdapLoginResult,
  LocalAuthStatus,
  LocalLoginInput,
  LocalLoginResult,
  LocalMfaFactorSummary,
  LocalMfaRecoveryCodes,
  LocalMfaVerifyInput,
  LocalMfaVerifyResult,
  OAuth2PkceStartResult,
  OidcPkceStartResult,
  SamlStartResult,
  StartOAuth2LoginInput,
  StartOidcLoginInput,
  StartSamlLoginInput,
  SupportSessionReport,
  SupportSessionRequestReport,
  SetLocalPasswordInput,
  TotpConfirmInput,
  TotpDisableInput,
  TotpEnrollment,
  TotpEnrollmentInput,
  UserSession,
} from "../types";
import { pathId } from "../path";

export function createSessionResource(transport: RomeoTransport) {
  return {
    startOidcLogin: (input: StartOidcLoginInput = {}) => {
      const params = new URLSearchParams();
      if (input.returnTo !== undefined) params.set("returnTo", input.returnTo);
      if (input.orgId !== undefined) params.set("orgId", input.orgId);
      if (input.providerId !== undefined)
        params.set("providerId", input.providerId);
      const query = params.size === 0 ? "" : `?${params.toString()}`;
      return transport.data<OidcPkceStartResult>(
        "GET",
        `/api/v1/auth/oidc/start${query}`,
      );
    },
    startOAuth2Login: (input: StartOAuth2LoginInput) => {
      const params = new URLSearchParams();
      params.set("providerId", input.providerId);
      if (input.returnTo !== undefined) params.set("returnTo", input.returnTo);
      if (input.orgId !== undefined) params.set("orgId", input.orgId);
      return transport.data<OAuth2PkceStartResult>(
        "GET",
        `/api/v1/auth/oauth2/start?${params.toString()}`,
      );
    },
    startSamlLogin: (input: StartSamlLoginInput = {}) => {
      const params = new URLSearchParams();
      if (input.providerId !== undefined)
        params.set("providerId", input.providerId);
      if (input.returnTo !== undefined) params.set("returnTo", input.returnTo);
      if (input.orgId !== undefined) params.set("orgId", input.orgId);
      const query = params.size === 0 ? "" : `?${params.toString()}`;
      return transport.data<SamlStartResult>(
        "GET",
        `/api/v1/auth/saml/start${query}`,
      );
    },
    localLogin: (input: LocalLoginInput) =>
      transport.data<LocalLoginResult>(
        "POST",
        "/api/v1/auth/local/login",
        input,
      ),
    ldapLogin: (input: LdapLoginInput) =>
      transport.data<LdapLoginResult>("POST", "/api/v1/auth/ldap/login", input),
    verifyLocalMfa: (input: LocalMfaVerifyInput) =>
      transport.data<LocalMfaVerifyResult>(
        "POST",
        "/api/v1/auth/local/mfa/verify",
        input,
      ),
    localAuthStatus: () =>
      transport.data<LocalAuthStatus>("GET", "/api/v1/auth/local/status"),
    setLocalPassword: (input: SetLocalPasswordInput) =>
      transport.data<LocalAuthStatus>(
        "POST",
        "/api/v1/auth/local/password",
        input,
      ),
    startTotpEnrollment: (input: TotpEnrollmentInput = {}) =>
      transport.data<TotpEnrollment>(
        "POST",
        "/api/v1/auth/local/mfa/totp/enroll",
        input,
      ),
    confirmTotpEnrollment: (input: TotpConfirmInput) =>
      transport.data<LocalMfaFactorSummary>(
        "POST",
        "/api/v1/auth/local/mfa/totp/confirm",
        input,
      ),
    generateRecoveryCodes: (input: GenerateRecoveryCodesInput) =>
      transport.data<LocalMfaRecoveryCodes>(
        "POST",
        "/api/v1/auth/local/mfa/recovery-codes/generate",
        input,
      ),
    disableMfaFactor: (factorId: string, input: TotpDisableInput = {}) =>
      transport.data<LocalMfaFactorSummary>(
        "POST",
        `/api/v1/auth/local/mfa/factors/${pathId(factorId)}/disable`,
        input,
      ),
    list: () => transport.data<UserSession[]>("GET", "/api/v1/sessions"),
    create: (input: CreateSessionInput = {}) =>
      transport.data<CreatedUserSession>("POST", "/api/v1/sessions", input),
    supportSessionReports: () =>
      transport.data<SupportSessionReport[]>(
        "GET",
        "/api/v1/admin/impersonation/sessions",
      ),
    createSupportSession: (input: CreateSupportSessionInput) =>
      transport.data<CreatedUserSession>(
        "POST",
        "/api/v1/admin/impersonation/sessions",
        input,
      ),
    revokeSupportSession: (sessionId: string) =>
      transport.data<SupportSessionReport>(
        "POST",
        `/api/v1/admin/impersonation/sessions/${pathId(sessionId)}/revoke`,
      ),
    supportSessionRequests: () =>
      transport.data<SupportSessionRequestReport[]>(
        "GET",
        "/api/v1/admin/impersonation/requests",
      ),
    requestSupportSession: (input: CreateSupportSessionInput) =>
      transport.data<SupportSessionRequestReport>(
        "POST",
        "/api/v1/admin/impersonation/requests",
        input,
      ),
    approveSupportSessionRequest: (requestId: string) =>
      transport.data<CreatedUserSession>(
        "POST",
        `/api/v1/admin/impersonation/requests/${pathId(requestId)}/approve`,
      ),
    rejectSupportSessionRequest: (requestId: string) =>
      transport.data<SupportSessionRequestReport>(
        "POST",
        `/api/v1/admin/impersonation/requests/${pathId(requestId)}/reject`,
      ),
    revokeCurrent: () =>
      transport.data<UserSession>("DELETE", "/api/v1/sessions/current"),
    revokeOthers: () =>
      transport.data<UserSession[]>("POST", "/api/v1/sessions/revoke-others"),
    revoke: (sessionId: string) =>
      transport.data<UserSession>(
        "DELETE",
        `/api/v1/sessions/${pathId(sessionId)}`,
      ),
  };
}
