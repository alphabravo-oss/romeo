import type { User } from "../domain/entities";
import type { LocalMfaFactor } from "../domain/entities";
import type { UserSessionSummary } from "./session-service";

export type LocalMfaMethod = "recovery_code" | "totp";

export type LocalLoginResult =
  | {
      status: "authenticated";
      session: UserSessionSummary;
      token: string;
    }
  | {
      status: "mfa_required";
      challengeToken: string;
      expiresAt: string;
      methods: LocalMfaMethod[];
    };

export interface LocalAuthStatus {
  factors: LocalMfaFactorSummary[];
  hasPassword: boolean;
  mfaEnabled: boolean;
  role: NonNullable<User["role"]>;
}

export interface LocalMfaFactorSummary {
  id: string;
  type: LocalMfaFactor["type"];
  name: string;
  status: LocalMfaFactor["status"];
  createdAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
  recoveryCodeRemainingCount?: number;
}

export interface TotpEnrollment {
  factor: LocalMfaFactorSummary;
  otpauthUri: string;
  secret: string;
}

export interface LocalMfaRecoveryCodes {
  factor: LocalMfaFactorSummary;
  codes: string[];
  recoveryCodeRemainingCount: number;
}
