import type { Scope, UserRole } from "@romeo/auth";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface SystemSetting {
  key: string;
  value: Record<string, unknown>;
  updatedAt: string;
}

export interface Workspace {
  defaultAgentId?: string;
  id: string;
  orgId: string;
  name: string;
  slug: string;
  archivedAt?: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role?: UserRole;
  disabledAt?: string;
}

export interface Group {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface GroupMembership {
  groupId: string;
  userId: string;
  orgId: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  orgId: string;
  userId?: string;
  serviceAccountId?: string;
  name: string;
  hashedToken: string;
  scopes: Scope[];
  revokedAt?: string;
  createdAt: string;
}

export interface ServiceAccount {
  id: string;
  orgId: string;
  name: string;
  scopes: Scope[];
  createdBy: string;
  disabledAt?: string;
  createdAt: string;
}

export interface UserSession {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  hashedToken: string;
  scopes: Scope[];
  isAdmin: boolean;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  createdAt: string;
}

export interface LocalPasswordCredential {
  id: string;
  orgId: string;
  userId: string;
  emailNormalized: string;
  passwordHash: string;
  failedAttemptCount: number;
  lockedUntil?: string;
  passwordUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMfaFactor {
  id: string;
  orgId: string;
  userId: string;
  type: "recovery_codes" | "totp";
  name: string;
  status: "pending" | "active" | "disabled";
  secretEncrypted: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
}
