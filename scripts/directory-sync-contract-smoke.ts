import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createSessionToken, hashApiKey } from "../packages/auth/src/index";
import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";

const output = argValue("--output");
const nonce = createHash("sha256")
  .update(`${process.pid}:${Date.now()}:${Math.random()}`)
  .digest("hex")
  .slice(0, 12);
const rawSentinels = {
  keepEmail: `directory-keep-${nonce}@romeo.local`,
  keepName: `Directory Keep ${nonce}`,
  disableEmail: `directory-disable-${nonce}@romeo.local`,
  disableName: `Directory Disable ${nonce}`,
  removeEmail: `directory-remove-${nonce}@romeo.local`,
  removeName: `Directory Remove ${nonce}`,
  adminEmail: `directory-admin-${nonce}@romeo.local`,
  adminName: `Directory Admin ${nonce}`,
  groupName: `Directory Engineers ${nonce}`,
  reason: `RAW_DIRECTORY_SYNC_REASON_${nonce}`,
};

const repository = new InMemoryRomeoRepository();
const api = createRomeoApi(repository, {
  env: readEnv({ DEV_SEEDED_LOGIN: "true" }),
});
const secureApi = createRomeoApi(repository, {
  env: readEnv({ DEV_SEEDED_LOGIN: "false" }),
});

const now = new Date().toISOString();
const groupId = `group_directory_sync_${nonce}`;
const keepUserId = `user_directory_keep_${nonce}`;
const disableUserId = `user_directory_disable_${nonce}`;
const removeUserId = `user_directory_remove_${nonce}`;
const adminUserId = `user_directory_admin_${nonce}`;
const targetApiKeyId = `api_key_directory_sync_${nonce}`;
const targetSessionId = `session_directory_sync_${nonce}`;
const targetApiToken = `rmk_directory_sync_${nonce}`;
const targetSessionToken = createSessionToken();

await repository.createUser({
  id: keepUserId,
  orgId: "org_default",
  email: rawSentinels.keepEmail,
  name: rawSentinels.keepName,
});
await repository.createUser({
  id: disableUserId,
  orgId: "org_default",
  email: rawSentinels.disableEmail,
  name: rawSentinels.disableName,
});
await repository.createUser({
  id: removeUserId,
  orgId: "org_default",
  email: rawSentinels.removeEmail,
  name: rawSentinels.removeName,
});
await repository.createUser({
  id: adminUserId,
  orgId: "org_default",
  email: rawSentinels.adminEmail,
  name: rawSentinels.adminName,
  role: "org_admin",
});
await repository.createApiKey({
  id: targetApiKeyId,
  orgId: "org_default",
  userId: disableUserId,
  name: "Directory sync target key",
  hashedToken: await hashApiKey(targetApiToken),
  scopes: ["me:read"],
  createdAt: now,
});
await repository.createUserSession({
  id: targetSessionId,
  orgId: "org_default",
  userId: disableUserId,
  name: "Directory sync target session",
  hashedToken: await hashApiKey(targetSessionToken),
  scopes: ["me:read"],
  isAdmin: false,
  expiresAt: "2030-01-01T00:00:00.000Z",
  createdAt: now,
});
await repository.createGroup({
  id: groupId,
  orgId: "org_default",
  name: rawSentinels.groupName,
  slug: `directory-sync-${nonce}`,
  createdAt: now,
});
for (const userId of ["user_dev_admin", keepUserId, removeUserId]) {
  await repository.createGroupMembership({
    groupId,
    userId,
    orgId: "org_default",
    createdAt: now,
  });
}

const unauthenticated = await secureApi.request(
  "/api/v1/admin/directory-sync",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "scim", disableMissingUsers: true }),
  },
);
assertStatus(unauthenticated, 401, "unauthenticated directory sync");

const requestBody = {
  source: "scim",
  disableMissingUsers: true,
  removeMissingGroupMembers: true,
  presentUserIds: [keepUserId, removeUserId, "user_dev_admin"],
  presentUserEmails: [rawSentinels.keepEmail.toUpperCase()],
  groupMemberships: [{ groupId, presentUserIds: [keepUserId] }],
  maxUserDisables: 2,
  maxMembershipRemovals: 2,
  reason: rawSentinels.reason,
};

const preview = await requestJson<DirectorySyncEnvelope>(
  "/api/v1/admin/directory-sync",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  },
);
assertStatus(preview.response, 200, "directory sync preview");
assertDirectorySyncResult(preview.body.data, {
  mode: "preview",
  status: "preview",
  userDisableCount: 1,
  membershipRemovalCount: 1,
  skippedAdminCount: 1,
  skippedSelfMembershipCount: 1,
});
assertNoRawSentinels(preview.text, "directory sync preview");

const missingConfirmation = await requestJson<{ error?: { code?: string } }>(
  "/api/v1/admin/directory-sync",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requestBody, dryRun: false }),
  },
);
assertStatus(missingConfirmation.response, 400, "directory sync confirmation");
if (
  missingConfirmation.body.error?.code !==
  "directory_sync_confirmation_required"
) {
  throw new Error("Directory sync apply did not require confirmation.");
}

const capped = await requestJson<{ error?: { code?: string } }>(
  "/api/v1/admin/directory-sync",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requestBody, maxUserDisables: 0 }),
  },
);
assertStatus(capped.response, 400, "directory sync disable cap");
if (capped.body.error?.code !== "directory_sync_user_disable_limit_exceeded") {
  throw new Error("Directory sync did not enforce user disable caps.");
}

const applied = await requestJson<DirectorySyncEnvelope>(
  "/api/v1/admin/directory-sync",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...requestBody,
      dryRun: false,
      confirmApply: "apply-directory-sync",
    }),
  },
);
assertStatus(applied.response, 200, "directory sync apply");
assertDirectorySyncResult(applied.body.data, {
  mode: "apply",
  status: "applied",
  userDisableCount: 1,
  membershipRemovalCount: 1,
  skippedAdminCount: 1,
  skippedSelfMembershipCount: 1,
});
assertNoRawSentinels(applied.text, "directory sync apply");

const disabledUser = await repository.getCurrentUser(disableUserId);
if (disabledUser?.disabledAt === undefined) {
  throw new Error("Directory sync apply did not disable the missing user.");
}
const preservedAdmin = await repository.getCurrentUser(adminUserId);
if (preservedAdmin?.disabledAt !== undefined) {
  throw new Error("Directory sync apply disabled a preserved admin user.");
}
const apiKeyRevoked =
  (await repository.listApiKeys("org_default")).find(
    (apiKey) => apiKey.id === targetApiKeyId,
  )?.revokedAt !== undefined;
const sessionRevoked =
  (await repository.listUserSessions("org_default", disableUserId)).find(
    (session) => session.id === targetSessionId,
  )?.revokedAt !== undefined;
if (!apiKeyRevoked || !sessionRevoked) {
  throw new Error("Directory sync apply did not revoke user credentials.");
}
const remainingMembers = (
  await repository.listGroupMemberships("org_default", groupId)
)
  .map((membership) => membership.userId)
  .sort();
if (
  remainingMembers.length !== 2 ||
  remainingMembers[0] !== "user_dev_admin" ||
  remainingMembers[1] !== keepUserId
) {
  throw new Error("Directory sync apply did not leave the expected members.");
}

const auditLogs = await repository.listAuditLogs("org_default");
const previewAudit = auditLogs.find(
  (entry) => entry.action === "directory_sync.preview",
);
const applyAudit = auditLogs.find(
  (entry) => entry.action === "directory_sync.apply",
);
const disableAudit = auditLogs.find(
  (entry) =>
    entry.action === "user.disable" && entry.resourceId === disableUserId,
);
if (
  previewAudit === undefined ||
  applyAudit === undefined ||
  disableAudit === undefined
) {
  throw new Error("Directory sync did not write expected audit events.");
}
if (
  applyAudit.metadata.schema !== "romeo.directory-sync.v1" ||
  applyAudit.metadata.userDisableCount !== 1 ||
  applyAudit.metadata.membershipRemovalCount !== 1 ||
  applyAudit.metadata.reasonProvided !== true
) {
  throw new Error("Directory sync apply audit metadata mismatch.");
}
const serializedAudit = JSON.stringify(auditLogs);
assertNoRawSentinels(serializedAudit, "directory sync audit");
assertNotContains(serializedAudit, targetApiToken, "directory sync audit");
assertNotContains(serializedAudit, targetSessionToken, "directory sync audit");

const evidence = {
  schemaVersion: "romeo.directory-sync-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "unauthenticated_directory_sync_denied",
    "preview_default_does_not_mutate",
    "apply_requires_confirmation",
    "user_disable_cap_enforced",
    "apply_disables_missing_user",
    "apply_preserves_admin_user_by_default",
    "apply_preserves_current_caller_membership",
    "apply_removes_stale_group_membership",
    "apply_revokes_disabled_user_credentials",
    "metadata_only_directory_sync_audit",
    "raw_directory_values_absent_from_responses_audit_and_evidence",
  ],
  endpoint: "/api/v1/admin/directory-sync",
  authorization: {
    unauthenticatedStatus: unauthenticated.status,
  },
  preview: {
    mode: preview.body.data.mode,
    status: preview.body.data.status,
    userDisableCount: preview.body.data.changes.userDisables.count,
    membershipRemovalCount: preview.body.data.changes.membershipRemovals.count,
    skippedAdminCount:
      preview.body.data.changes.userDisables.skippedAdminUserIds.length,
    skippedSelfMembershipCount:
      preview.body.data.changes.membershipRemovals.skippedSelfUserIds.length,
    warningCodes: preview.body.data.warnings,
  },
  guardrails: {
    missingConfirmationStatus: missingConfirmation.response.status,
    missingConfirmationCode: missingConfirmation.body.error?.code,
    capExceededStatus: capped.response.status,
    capExceededCode: capped.body.error?.code,
  },
  apply: {
    mode: applied.body.data.mode,
    status: applied.body.data.status,
    userDisableCount: applied.body.data.changes.userDisables.count,
    membershipRemovalCount: applied.body.data.changes.membershipRemovals.count,
    disabledUserIdHash: sha256(disableUserId),
    groupIdHash: sha256(groupId),
    remainingMemberCount: remainingMembers.length,
    adminPreserved: true,
    callerMembershipPreserved: true,
    apiKeyRevoked,
    sessionRevoked,
  },
  audit: {
    previewAction: previewAudit.action,
    applyAction: applyAudit.action,
    disableAction: disableAudit.action,
    schema: applyAudit.metadata.schema,
    reasonProvided: applyAudit.metadata.reasonProvided,
    userDisableCount: applyAudit.metadata.userDisableCount,
    membershipRemovalCount: applyAudit.metadata.membershipRemovalCount,
  },
  redaction: {
    rawEmailsReturned: false,
    rawNamesReturned: false,
    rawDirectoryReasonReturned: false,
    rawCredentialTokensReturned: false,
    rawGroupNameReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoRawSentinels(serialized, "directory sync evidence");
assertNotContains(serialized, targetApiKeyId, "directory sync evidence");
assertNotContains(serialized, targetSessionId, "directory sync evidence");
assertNotContains(serialized, targetApiToken, "directory sync evidence");
assertNotContains(serialized, targetSessionToken, "directory sync evidence");

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote directory sync contract smoke evidence to ${outputPath}`);
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: T; text: string }> {
  const response = await api.request(path, init);
  const text = await response.text();
  return { response, body: JSON.parse(text) as T, text };
}

function assertDirectorySyncResult(
  result: DirectorySyncResult | undefined,
  expected: {
    membershipRemovalCount: number;
    mode: "apply" | "preview";
    skippedAdminCount: number;
    skippedSelfMembershipCount: number;
    status: "applied" | "preview";
    userDisableCount: number;
  },
): void {
  if (result === undefined) throw new Error("Directory sync result missing.");
  if (result.schema !== "romeo.directory-sync.v1")
    throw new Error("Directory sync result schema mismatch.");
  if (result.mode !== expected.mode || result.status !== expected.status)
    throw new Error("Directory sync result mode/status mismatch.");
  if (result.changes.userDisables.count !== expected.userDisableCount)
    throw new Error("Directory sync user disable count mismatch.");
  if (
    result.changes.membershipRemovals.count !== expected.membershipRemovalCount
  ) {
    throw new Error("Directory sync membership removal count mismatch.");
  }
  if (
    result.changes.userDisables.skippedAdminUserIds.length !==
    expected.skippedAdminCount
  ) {
    throw new Error("Directory sync skipped admin count mismatch.");
  }
  if (
    result.changes.membershipRemovals.skippedSelfUserIds.length !==
    expected.skippedSelfMembershipCount
  ) {
    throw new Error("Directory sync skipped self membership count mismatch.");
  }
  assertFalseFlags(result.redaction, [
    "externalGroupNamesReturned",
    "externalSubjectIdsReturned",
    "rawDirectoryPayloadReturned",
    "userEmailsReturned",
    "userNamesReturned",
  ]);
}

function assertFalseFlags(
  flags: Record<string, boolean> | undefined,
  required: string[],
): void {
  for (const flag of required) {
    if (flags?.[flag] !== false) {
      throw new Error(`Expected ${flag} redaction flag to be false.`);
    }
  }
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`,
    );
  }
}

function assertNoRawSentinels(value: string, label: string): void {
  for (const sentinel of Object.values(rawSentinels)) {
    assertNotContains(value, sentinel, label);
  }
}

function assertNotContains(value: string, forbidden: string, label: string) {
  if (value.includes(forbidden)) {
    throw new Error(`${label} leaked forbidden directory sync content.`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

interface DirectorySyncEnvelope {
  data?: DirectorySyncResult;
}

interface DirectorySyncResult {
  changes: {
    membershipRemovals: {
      count: number;
      groups: Array<{ count: number; groupId: string; userIds: string[] }>;
      skippedSelfUserIds: string[];
    };
    userDisables: {
      count: number;
      skippedAdminUserIds: string[];
      skippedSelfUserIds: string[];
      userIds: string[];
    };
  };
  mode: "apply" | "preview";
  redaction: Record<string, boolean>;
  schema: "romeo.directory-sync.v1";
  status: "applied" | "preview";
  warnings: string[];
}
