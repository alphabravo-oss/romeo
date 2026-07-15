import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";

const output = argValue("--output");
const nonce = createHash("sha256")
  .update(`${process.pid}:${Date.now()}:${Math.random()}`)
  .digest("hex")
  .slice(0, 12);
const rawSentinels = {
  email: `raw-scim-user-${nonce}@romeo.local`,
  givenName: `RawScimGiven${nonce}`,
  familyName: `RawScimFamily${nonce}`,
  groupName: `SCIM Evidence Group ${nonce}`,
};

const disabledRepository = new InMemoryRomeoRepository();
const disabledApi = createRomeoApi(disabledRepository, {
  env: readEnv({ SCIM_ENABLED: "false" }),
});
const disabledScim = await requestJson<ScimErrorBody>(
  disabledApi,
  "/api/v1/scim/v2/ServiceProviderConfig",
);
assertStatus(disabledScim.response, 404, "disabled SCIM service-provider");
if (disabledScim.body.scimType !== "scim_disabled") {
  throw new Error("Disabled SCIM posture did not fail closed.");
}

const repository = new InMemoryRomeoRepository();
const api = createRomeoApi(repository, {
  env: readEnv({ DEV_SEEDED_LOGIN: "true", SCIM_ENABLED: "true" }),
});

const policy = await requestJson<{
  data?: {
    policy?: { scim?: string };
    scim?: { status?: string; supportedResources?: string[] };
  };
}>(api, "/api/v1/governance/identity-lifecycle-policy");
assertStatus(policy.response, 200, "identity lifecycle policy");
if (
  policy.body.data?.policy?.scim !== "enabled" ||
  policy.body.data.scim?.status !== "enabled" ||
  !includesAll(policy.body.data.scim.supportedResources, ["User", "Group"])
) {
  throw new Error("Identity lifecycle policy did not report enabled SCIM.");
}

const serviceProvider = await requestJson<{
  patch?: { supported?: boolean };
}>(api, "/api/v1/scim/v2/ServiceProviderConfig");
assertStatus(serviceProvider.response, 200, "SCIM service-provider");
assertScimContentType(serviceProvider.response, "SCIM service-provider");
if (serviceProvider.body.patch?.supported !== true) {
  throw new Error("SCIM service-provider config did not advertise PATCH.");
}

const resourceTypes = await requestJson<{
  Resources?: Array<{ id?: string; name?: string }>;
}>(api, "/api/v1/scim/v2/ResourceTypes");
assertStatus(resourceTypes.response, 200, "SCIM resource types");
const resourceTypeNames = new Set(
  resourceTypes.body.Resources?.map((resource) => resource.name) ?? [],
);
if (!resourceTypeNames.has("User") || !resourceTypeNames.has("Group")) {
  throw new Error("SCIM resource types did not include User and Group.");
}

const createdUser = await requestJson<ScimUserResource>(
  api,
  "/api/v1/scim/v2/Users",
  {
    method: "POST",
    headers: { "content-type": "application/scim+json" },
    body: JSON.stringify({
      userName: rawSentinels.email.toUpperCase(),
      name: {
        givenName: rawSentinels.givenName,
        familyName: rawSentinels.familyName,
      },
      active: true,
    }),
  },
);
assertStatus(createdUser.response, 201, "SCIM user create");
assertScimContentType(createdUser.response, "SCIM user create");
if (
  createdUser.body.id === undefined ||
  createdUser.body.userName !== rawSentinels.email ||
  createdUser.body.active !== true
) {
  throw new Error("SCIM user create did not return the expected user.");
}

const createdGroup = await requestJson<ScimGroupResource>(
  api,
  "/api/v1/scim/v2/Groups",
  {
    method: "POST",
    headers: { "content-type": "application/scim+json" },
    body: JSON.stringify({
      displayName: rawSentinels.groupName,
      members: [{ value: createdUser.body.id }],
    }),
  },
);
assertStatus(createdGroup.response, 201, "SCIM group create");
assertScimContentType(createdGroup.response, "SCIM group create");
if (
  createdGroup.body.id === undefined ||
  createdGroup.body.displayName !== rawSentinels.groupName ||
  createdGroup.body.members?.length !== 1 ||
  createdGroup.body.members[0]?.value !== createdUser.body.id
) {
  throw new Error("SCIM group create did not return the expected membership.");
}

const grantId = `grant_scim_lifecycle_${nonce}`;
await repository.createResourceGrant({
  id: grantId,
  resourceType: "workspace",
  resourceId: "workspace_default",
  principalType: "group",
  principalId: createdGroup.body.id,
  permission: "read",
});
if (!(await hasGrant(grantId))) {
  throw new Error("SCIM lifecycle smoke could not seed a group grant.");
}

const deleteGroup = await api.request(
  `/api/v1/scim/v2/Groups/${encodeURIComponent(createdGroup.body.id)}`,
  { method: "DELETE" },
);
assertStatus(deleteGroup, 204, "SCIM group delete");

if ((await repository.getGroup(createdGroup.body.id)) !== undefined) {
  throw new Error("SCIM group delete left the group record behind.");
}
const remainingMemberships = await repository.listGroupMemberships(
  "org_default",
  createdGroup.body.id,
);
if (remainingMemberships.length !== 0) {
  throw new Error("SCIM group delete left memberships behind.");
}
if (await hasGrant(grantId)) {
  throw new Error("SCIM group delete left the group resource grant behind.");
}

const deletedGroupReadback = await requestJson<ScimErrorBody>(
  api,
  `/api/v1/scim/v2/Groups/${encodeURIComponent(createdGroup.body.id)}`,
);
assertStatus(deletedGroupReadback.response, 404, "deleted SCIM group readback");
assertScimContentType(deletedGroupReadback.response, "deleted group readback");
if (deletedGroupReadback.body.status !== "404") {
  throw new Error("Deleted SCIM group readback was not SCIM-shaped.");
}

const auditLogs = await repository.listAuditLogs("org_default");
const groupDeleteAudit = auditLogs.find(
  (entry) =>
    entry.action === "scim.group.delete" &&
    entry.resourceId === createdGroup.body.id,
);
if (groupDeleteAudit === undefined) {
  throw new Error("SCIM group delete audit log was not recorded.");
}
if (groupDeleteAudit.metadata.schema !== "romeo.scim.audit.v1") {
  throw new Error("SCIM group delete audit schema mismatch.");
}
if (groupDeleteAudit.metadata.membershipCount !== 1) {
  throw new Error("SCIM group delete audit membership count mismatch.");
}
if (groupDeleteAudit.metadata.revokedGrantCount !== 1) {
  throw new Error("SCIM group delete audit revoked grant count mismatch.");
}

const serializedAudit = JSON.stringify(auditLogs);
assertNoRawSentinels(serializedAudit, "SCIM audit logs");

const evidence = {
  schemaVersion: "romeo.scim-lifecycle-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "scim_disabled_fail_closed",
    "identity_lifecycle_policy_reports_scim_resources",
    "service_provider_config_scim_json_and_patch",
    "resource_types_include_user_and_group",
    "scim_user_create",
    "scim_group_create_with_member",
    "group_principal_grant_seeded",
    "scim_group_delete_returns_204",
    "group_record_removed",
    "group_memberships_removed",
    "group_resource_grants_revoked",
    "deleted_group_readback_returns_scim_404",
    "metadata_only_group_delete_audit",
    "raw_scim_values_absent_from_audit_and_evidence",
  ],
  endpoints: {
    serviceProviderConfig: "/api/v1/scim/v2/ServiceProviderConfig",
    resourceTypes: "/api/v1/scim/v2/ResourceTypes",
    users: "/api/v1/scim/v2/Users",
    groups: "/api/v1/scim/v2/Groups",
    identityLifecyclePolicy: "/api/v1/governance/identity-lifecycle-policy",
  },
  posture: {
    disabledServiceProviderStatus: disabledScim.response.status,
    disabledServiceProviderScimType: disabledScim.body.scimType,
    identityLifecycleScim: policy.body.data?.policy?.scim,
    supportedResources: policy.body.data?.scim?.supportedResources,
    patchSupported: serviceProvider.body.patch?.supported,
  },
  lifecycle: {
    userIdHash: sha256(createdUser.body.id),
    groupIdHash: sha256(createdGroup.body.id),
    seededMemberCount: 1,
    deleteStatus: deleteGroup.status,
    postDeleteMembershipCount: remainingMemberships.length,
    grantRevoked: true,
    deletedReadbackStatus: deletedGroupReadback.response.status,
  },
  audit: {
    action: groupDeleteAudit.action,
    resourceType: groupDeleteAudit.resourceType,
    metadataSchema: groupDeleteAudit.metadata.schema,
    membershipCount: groupDeleteAudit.metadata.membershipCount,
    revokedGrantCount: groupDeleteAudit.metadata.revokedGrantCount,
    destructiveDelete: groupDeleteAudit.metadata.destructiveDelete,
  },
  redaction: {
    rawEmailReturned: false,
    rawDisplayNameReturned: false,
    rawGivenNameReturned: false,
    rawFamilyNameReturned: false,
    rawGrantIdReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoRawSentinels(serialized, "SCIM lifecycle evidence");
assertNotContains(serialized, grantId, "SCIM lifecycle evidence");

if (output === undefined) process.stdout.write(serialized);
else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote SCIM lifecycle contract smoke evidence to ${outputPath}`);
}

async function hasGrant(grantId: string): Promise<boolean> {
  return (await repository.listResourceGrants("org_default")).some(
    (grant) => grant.id === grantId,
  );
}

async function requestJson<T>(
  targetApi: {
    request: (path: string, init?: RequestInit) => Promise<Response>;
  },
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: T }> {
  const response = await targetApi.request(path, init);
  return { response, body: (await response.json()) as T };
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

function assertScimContentType(response: Response, label: string): void {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/scim+json")) {
    throw new Error(`${label} did not return application/scim+json.`);
  }
}

function assertNoRawSentinels(value: string, label: string): void {
  for (const sentinel of [
    rawSentinels.email,
    rawSentinels.email.toUpperCase(),
    rawSentinels.givenName,
    rawSentinels.familyName,
    rawSentinels.groupName,
  ]) {
    assertNotContains(value, sentinel, label);
  }
}

function assertNotContains(value: string, forbidden: string, label: string) {
  if (value.includes(forbidden)) {
    throw new Error(`${label} leaked forbidden SCIM content.`);
  }
}

function includesAll(
  values: string[] | undefined,
  expected: string[],
): boolean {
  const valueSet = new Set(values ?? []);
  return expected.every((item) => valueSet.has(item));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

interface ScimUserResource {
  id?: string;
  userName?: string;
  active?: boolean;
}

interface ScimGroupResource {
  id?: string;
  displayName?: string;
  members?: Array<{ value?: string }>;
}

interface ScimErrorBody {
  schemas?: string[];
  detail?: string;
  status?: string;
  scimType?: string;
}
