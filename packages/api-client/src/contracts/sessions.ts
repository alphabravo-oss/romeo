import type { Scope } from "./common";
import type { AuthProviderId } from "./admin";

export interface UserSession {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  scopes: Scope[];
  isAdmin: boolean;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface CreateSessionInput {
  name?: string;
  ttlHours?: number;
}

export interface CreateSupportSessionInput {
  confirmTargetUserId: string;
  reason: string;
  targetUserId: string;
  ticketRef?: string;
  ttlMinutes?: number;
}

export interface CreatedUserSession {
  session: UserSession;
  token: string;
}

export interface LocalLoginInput {
  email: string;
  orgId?: string;
  password: string;
  recoveryCode?: string;
  totpCode?: string;
}

export interface LdapLoginInput {
  identifier: string;
  orgId?: string;
  password: string;
  providerId: Extract<AuthProviderId, "active-directory" | "ldap">;
}

export type LdapLoginResult = {
  status: "authenticated";
} & CreatedUserSession;

export type LocalLoginResult =
  | ({ status: "authenticated" } & CreatedUserSession)
  | {
      status: "mfa_required";
      challengeToken: string;
      expiresAt: string;
      methods: ["totp"];
    };

export interface LocalMfaVerifyInput {
  challengeToken: string;
  code?: string;
  recoveryCode?: string;
}

export type LocalMfaVerifyResult = {
  status: "authenticated";
} & CreatedUserSession;

export interface LocalMfaFactorSummary {
  id: string;
  type: "recovery_codes" | "totp";
  name: string;
  status: "active" | "disabled" | "pending";
  createdAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
  recoveryCodeRemainingCount?: number;
}

export interface LocalAuthStatus {
  hasPassword: boolean;
  mfaEnabled: boolean;
  role?: "global_admin" | "org_admin" | "user";
  factors: LocalMfaFactorSummary[];
}

export interface SetLocalPasswordInput {
  currentPassword?: string;
  newPassword: string;
}

export interface TotpEnrollmentInput {
  name?: string;
}

export interface TotpEnrollment {
  factor: LocalMfaFactorSummary;
  otpauthUri: string;
  secret: string;
}

export interface TotpConfirmInput {
  factorId: string;
  code: string;
}

export interface TotpDisableInput {
  code?: string;
}

export interface GenerateRecoveryCodesInput {
  totpCode: string;
}

export interface LocalMfaRecoveryCodes {
  factor: LocalMfaFactorSummary;
  codes: string[];
  recoveryCodeRemainingCount: number;
}

interface PkceStartResult {
  authorizationUrl: string;
  expiresAt: string;
}

export interface OidcPkceStartResult extends PkceStartResult {
  orgId: string;
  providerId?: AuthProviderId;
}

export interface OAuth2PkceStartResult extends PkceStartResult {
  providerId: "github";
}

export interface SamlStartResult extends PkceStartResult {
  providerId: "saml";
}

export interface StartOidcLoginInput {
  orgId?: string;
  providerId?: AuthProviderId;
  returnTo?: string;
}

export interface StartOAuth2LoginInput {
  orgId?: string;
  providerId: Extract<AuthProviderId, "github">;
  returnTo?: string;
}

export interface StartSamlLoginInput {
  orgId?: string;
  providerId?: Extract<AuthProviderId, "saml">;
  returnTo?: string;
}

export interface SupportSessionReport {
  adminUserId: string;
  approvalRequestId?: string;
  createdAuditLogId: string;
  reasonHash?: string;
  reasonLength?: number;
  requestedByUserId?: string;
  session: UserSession;
  status: "active" | "expired" | "revoked";
  targetUserId: string;
  ticketRef?: string;
  ttlMinutes?: number;
}

export interface SupportSessionRequestReport {
  id: string;
  status: "pending" | "approved" | "rejected";
  requestedByUserId: string;
  targetUserId: string;
  ttlMinutes: number;
  createdAt: string;
  approvedAt?: string;
  approvedByUserId?: string;
  rejectedAt?: string;
  rejectedByUserId?: string;
  sessionId?: string;
  ticketRef?: string;
  reasonHash?: string;
  reasonLength?: number;
}
