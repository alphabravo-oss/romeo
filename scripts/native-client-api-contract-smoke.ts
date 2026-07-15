import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { MemoryObjectStore } from "../packages/storage/src/memory-object-store";

type Api = ReturnType<typeof createRomeoApi>;
type JsonRecord = Record<string, unknown>;

const output = argValue("--output");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pid = process.pid;
const rawValues = {
  fileContent: `RAW_NATIVE_FILE_CONTENT_${pid}`,
  mobilePushTokenRef: `env://ROMEO_NATIVE_MOBILE_TOKEN_${pid}`,
  mobilePushTokenValue: `RAW_NATIVE_MOBILE_TOKEN_VALUE_${pid}`,
};

const repository = new InMemoryRomeoRepository();
const objectStore = new MemoryObjectStore();
const api = createApi(repository, objectStore);

const device = await proveDeviceAuthorizationContract(api, repository);
const upload = await proveResumableUploadContract(
  api,
  objectStore,
  device.initialAccessToken,
);
const mobilePush = await proveMobilePushChannelRedaction(
  api,
  repository,
  device.initialAccessToken,
);

const evidence = {
  schemaVersion: "romeo.native-client-api-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "device_authorization_create_list_redacts_refresh_hash",
    "device_authorization_scope_escalation_denied",
    "device_authorization_refresh_rotates_and_revokes_old_credentials",
    "device_authorization_refresh_public_route_secure_mode",
    "device_authorization_revoke_invalidates_access_and_refresh",
    "resumable_upload_requires_device_file_scopes_and_redacts_object_keys",
    "resumable_upload_composes_parts_and_cleans_staging",
    "mobile_push_channel_readback_redacts_token_ref",
    "native_client_evidence_omits_tokens_secret_refs_object_keys_and_content",
  ],
  deviceAuthorization: device.evidence,
  resumableUpload: upload.evidence,
  mobilePush: mobilePush.evidence,
  redaction: {
    rawAccessTokensReturned: false,
    rawRefreshTokensReturned: false,
    hashedRefreshTokensReturned: false,
    rawMobilePushTokenRefsReturned: false,
    rawMobilePushTokenValuesReturned: false,
    objectStoreKeysReturned: false,
    uploadUrlsReturned: false,
    rawFileContentReturned: false,
  },
};

assertNoSensitiveValues("native client evidence", JSON.stringify(evidence), [
  ...device.sensitiveValues,
  ...upload.sensitiveValues,
  ...mobilePush.sensitiveValues,
]);
writeEvidence(output, evidence);
process.stdout.write(`Wrote native-client API contract to ${output}.\n`);

async function proveDeviceAuthorizationContract(
  baseApi: Api,
  repo: InMemoryRomeoRepository,
): Promise<{
  evidence: JsonRecord;
  initialAccessToken: string;
  sensitiveValues: string[];
}> {
  const created = await postJson(
    baseApi,
    "/api/v1/device-authorizations",
    {
      name: "Romeo native client",
      scopes: ["me:read", "files:read", "files:write"],
      ttlDays: 30,
    },
    201,
  );
  const initialAccessToken = stringValue(created.data.accessToken);
  const initialRefreshToken = stringValue(created.data.refreshToken);
  const authorization = recordValue(created.data.authorization);
  const authorizationId = stringValue(authorization.id);
  const accessApiKeyId = stringValue(authorization.accessApiKeyId);
  assert(
    /^rmk_[a-f0-9]{48}$/u.test(initialAccessToken),
    "Bad access token shape.",
  );
  assert(
    /^rmr_[a-f0-9]{48}$/u.test(initialRefreshToken),
    "Bad refresh token shape.",
  );
  assert(
    !JSON.stringify(authorization).includes("hashedRefreshToken"),
    "Device authorization create response returned refresh hash.",
  );

  const listed = await requestJson(baseApi, "/api/v1/device-authorizations", {
    headers: bearer(initialAccessToken),
  });
  assertStatus(listed.status, 200, "device authorization list");
  assert(
    !JSON.stringify(listed.body).includes("hashedRefreshToken"),
    "Device authorization list returned refresh hash.",
  );

  const me = await requestJson(baseApi, "/api/v1/me", {
    headers: bearer(initialAccessToken),
  });
  assertStatus(me.status, 200, "device access /me");
  assert(
    me.body.subject?.apiKeyId === accessApiKeyId,
    "Device access token did not bind to the expected API key.",
  );

  const limited = await postJson(
    baseApi,
    "/api/v1/device-authorizations",
    {
      name: "Limited native client",
      scopes: ["me:read"],
    },
    201,
  );
  const limitedAccessToken = stringValue(limited.data.accessToken);
  const escalation = await requestJson(
    baseApi,
    "/api/v1/device-authorizations",
    {
      method: "POST",
      headers: jsonHeaders(limitedAccessToken),
      body: JSON.stringify({
        name: "Scope escalation attempt",
        scopes: ["admin:write"],
      }),
    },
  );
  assertStatus(escalation.status, 400, "device scope escalation");
  assert(
    escalation.body.error?.code === "device_authorization_scope_exceeded",
    "Device scope escalation did not fail with the expected code.",
  );

  const secureApi = createApi(repo, objectStore, { DEV_SEEDED_LOGIN: "false" });
  const refreshed = await postJson(
    secureApi,
    "/api/v1/device-authorizations/refresh",
    { refreshToken: initialRefreshToken },
  );
  const refreshedAccessToken = stringValue(refreshed.data.accessToken);
  const refreshedRefreshToken = stringValue(refreshed.data.refreshToken);
  assert(
    refreshedAccessToken !== initialAccessToken,
    "Access token was not rotated.",
  );
  assert(
    refreshedRefreshToken !== initialRefreshToken,
    "Refresh token was not rotated.",
  );

  const oldAccess = await requestJson(secureApi, "/api/v1/me", {
    headers: bearer(initialAccessToken),
  });
  const oldRefresh = await requestJson(
    secureApi,
    "/api/v1/device-authorizations/refresh",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: initialRefreshToken }),
    },
  );
  const newAccess = await requestJson(secureApi, "/api/v1/me", {
    headers: bearer(refreshedAccessToken),
  });
  assertStatus(oldAccess.status, 403, "old device access token");
  assertStatus(oldRefresh.status, 403, "old device refresh token");
  assertStatus(newAccess.status, 200, "new device access token");

  const revoked = await requestJson(
    secureApi,
    `/api/v1/device-authorizations/${authorizationId}/revoke`,
    { method: "POST", headers: bearer(refreshedAccessToken) },
  );
  const revokedAccess = await requestJson(secureApi, "/api/v1/me", {
    headers: bearer(refreshedAccessToken),
  });
  const revokedRefresh = await requestJson(
    secureApi,
    "/api/v1/device-authorizations/refresh",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refreshedRefreshToken }),
    },
  );
  assertStatus(revoked.status, 200, "device revoke");
  assertStatus(revokedAccess.status, 403, "revoked device access token");
  assertStatus(revokedRefresh.status, 403, "revoked device refresh token");

  const active = await postJson(
    baseApi,
    "/api/v1/device-authorizations",
    {
      name: "Active native client",
      scopes: ["me:read", "files:read", "files:write"],
      ttlDays: 30,
    },
    201,
  );
  const activeAccessToken = stringValue(active.data.accessToken);
  const activeRefreshToken = stringValue(active.data.refreshToken);

  return {
    initialAccessToken: activeAccessToken,
    sensitiveValues: [
      initialAccessToken,
      initialRefreshToken,
      refreshedAccessToken,
      refreshedRefreshToken,
      limitedAccessToken,
      activeAccessToken,
      activeRefreshToken,
    ],
    evidence: {
      createStatus: 201,
      accessTokenPrefix: "rmk",
      refreshTokenPrefix: "rmr",
      authorizationScopes: authorization.scopes,
      listStatus: listed.status,
      listCount: Array.isArray(listed.body.data) ? listed.body.data.length : 0,
      meStatus: me.status,
      subjectApiKeyMatched: true,
      hashedRefreshTokenReturned: false,
      scopeEscalationStatus: escalation.status,
      scopeEscalationErrorCode: escalation.body.error?.code,
      secureRefreshWithoutAccessStatus: 200,
      rotatedAccessToken: true,
      rotatedRefreshToken: true,
      oldAccessStatus: oldAccess.status,
      oldRefreshStatus: oldRefresh.status,
      newAccessStatus: newAccess.status,
      revokeStatus: revoked.status,
      revokedAccessStatus: revokedAccess.status,
      revokedRefreshStatus: revokedRefresh.status,
      postRevokeScopedAccessStatus: 201,
    },
  };
}

async function proveResumableUploadContract(
  apiForUpload: Api,
  store: MemoryObjectStore,
  accessToken: string,
): Promise<{ evidence: JsonRecord; sensitiveValues: string[] }> {
  const bytes = new TextEncoder().encode(rawValues.fileContent);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const created = await requestJson(
    apiForUpload,
    "/api/v1/files/uploads/resumable",
    {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: "../Native Resumable.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
        sha256,
        partSizeBytes: 7,
        purpose: "general",
        metadata: { clientHint: "native" },
      }),
    },
  );
  assertStatus(created.status, 201, "resumable upload create");
  assert(
    !JSON.stringify(created.body.data.file).includes("objectKey"),
    "Resumable upload create returned an object key.",
  );
  const file = recordValue(created.body.data.file);
  const upload = recordValue(created.body.data.upload);
  const fileId = stringValue(file.id);
  const fileName = stringValue(file.fileName);
  const objectKey = `files/org_default/workspace_default/${fileId}/${fileName}`;
  const uploadUrls = parts(upload).map((part) =>
    stringValue(recordValue(part.upload).url),
  );

  const refreshed = await requestJson(
    apiForUpload,
    `/api/v1/files/uploads/resumable/${fileId}`,
    { headers: bearer(accessToken) },
  );
  assertStatus(refreshed.status, 200, "resumable upload refresh");

  for (const part of parts(upload)) {
    const start = (part.partNumber - 1) * Number(upload.partSizeBytes);
    await store.putObject({
      key: partKey(objectKey, part.partNumber),
      body: bytes.slice(start, start + part.sizeBytes),
      contentType: "application/octet-stream",
    });
  }

  const completed = await requestJson(
    apiForUpload,
    `/api/v1/files/uploads/resumable/${fileId}/complete`,
    { method: "POST", headers: bearer(accessToken) },
  );
  assertStatus(completed.status, 200, "resumable upload complete");

  const content = await apiForUpload.request(
    `/api/v1/files/${fileId}/content`,
    {
      headers: bearer(accessToken),
    },
  );
  const readback = await content.text();
  assertStatus(content.status, 200, "resumable upload content");
  assert(
    readback === rawValues.fileContent,
    "Resumable upload readback mismatch.",
  );
  assert(
    (await store.getObject(partKey(objectKey, 1))) === undefined,
    "Resumable upload staging part was not cleaned up.",
  );
  assert(
    !JSON.stringify(completed.body.data).includes("objectKey"),
    "Resumable upload complete returned an object key.",
  );

  return {
    sensitiveValues: [
      rawValues.fileContent,
      objectKey,
      encodeURIComponent(objectKey),
      ...uploadUrls,
    ],
    evidence: {
      createStatus: created.status,
      refreshStatus: refreshed.status,
      completeStatus: completed.status,
      contentReadbackStatus: content.status,
      createdFileStatus: file.status,
      completedFileStatus: completed.body.data.status,
      uploadMode: upload.mode,
      partCount: upload.partCount,
      partSizeBytes: upload.partSizeBytes,
      maxBytes: upload.maxBytes,
      readbackBytes: bytes.byteLength,
      readbackSha256: sha256,
      stagedPartCleanupVerified: true,
      objectKeyReturned: false,
      uploadUrlsPersisted: false,
      rawContentReturned: false,
    },
  };
}

async function proveMobilePushChannelRedaction(
  apiForChannels: Api,
  repo: InMemoryRomeoRepository,
  accessToken: string,
): Promise<{ evidence: JsonRecord; sensitiveValues: string[] }> {
  const created = await requestJson(
    apiForChannels,
    "/api/v1/notification-channels",
    {
      method: "POST",
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        type: "mobile_push",
        name: "Native mobile push",
        config: {
          tokenRef: rawValues.mobilePushTokenRef,
          platform: "ios",
          collapseKey: "romeo-native",
        },
      }),
    },
  );
  assertStatus(created.status, 201, "mobile push channel create");
  assert(
    created.body.data?.config?.tokenConfigured === true &&
      created.body.data?.config?.tokenRefScheme === "env" &&
      created.body.data?.config?.tokenRef === undefined,
    "Mobile push create readback did not redact tokenRef.",
  );

  const listed = await requestJson(
    apiForChannels,
    "/api/v1/notification-channels",
    {
      headers: bearer(accessToken),
    },
  );
  assertStatus(listed.status, 200, "mobile push channel list");
  const publicReadback = JSON.stringify({
    created: created.body,
    listed: listed.body,
  });
  assertNoSensitiveValues("mobile push public readback", publicReadback, [
    rawValues.mobilePushTokenRef,
    rawValues.mobilePushTokenValue,
  ]);

  const stored = await repo.listNotificationDeliveryChannels(
    "org_default",
    "user_dev_admin",
  );
  const storedMobilePush = stored.find(
    (channel) => channel.type === "mobile_push",
  );
  assert(
    storedMobilePush?.config.tokenRef === rawValues.mobilePushTokenRef,
    "Mobile push tokenRef was not retained internally for delivery.",
  );

  return {
    sensitiveValues: [
      rawValues.mobilePushTokenRef,
      rawValues.mobilePushTokenValue,
    ],
    evidence: {
      createStatus: created.status,
      listStatus: listed.status,
      listCount: Array.isArray(listed.body.data) ? listed.body.data.length : 0,
      tokenConfigured: true,
      tokenRefScheme: "env",
      tokenRefReturned: false,
      tokenRefRetainedInternally: true,
      platform: "ios",
      collapseKeyReturned: "romeo-native",
    },
  };
}

function createApi(
  repo: InMemoryRomeoRepository,
  store: MemoryObjectStore,
  env: Record<string, string> = {},
): Api {
  return createRomeoApi(repo, {
    objectStore: store,
    env: readEnv({
      FILE_DIRECT_UPLOAD_MAX_BYTES: "8",
      FILE_RESUMABLE_UPLOAD_MAX_BYTES: "64",
      ...env,
    }),
  });
}

async function requestJson(
  apiForRequest: Api,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const response = await apiForRequest.request(path, init);
  const body = await response.json();
  return { status: response.status, body };
}

async function postJson(
  apiForRequest: Api,
  path: string,
  body: unknown,
  expectedStatus = 200,
): Promise<any> {
  const response = await requestJson(apiForRequest, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assertStatus(response.status, expectedStatus, path);
  return response.body;
}

function parts(upload: JsonRecord): Array<{
  partNumber: number;
  sizeBytes: number;
  upload: JsonRecord;
}> {
  if (!Array.isArray(upload.parts)) throw new Error("Expected upload parts.");
  return upload.parts.map((part) => {
    const value = recordValue(part);
    return {
      partNumber: Number(value.partNumber),
      sizeBytes: Number(value.sizeBytes),
      upload: recordValue(value.upload),
    };
  });
}

function partKey(objectKey: string, partNumber: number): string {
  return `${objectKey}.parts/${String(partNumber).padStart(6, "0")}`;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
  return { ...bearer(token), "content-type": "application/json" };
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected non-empty string value.");
  }
  return value;
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON object.");
  }
  return value as JsonRecord;
}

function assertStatus(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} returned ${actual}, expected ${expected}.`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoSensitiveValues(
  label: string,
  value: string,
  sensitiveValues: string[],
): void {
  const leaked = sensitiveValues.filter((sensitive) =>
    value.includes(sensitive),
  );
  if (leaked.length > 0) {
    throw new Error(`${label} leaked native-client sensitive values.`);
  }
}

function writeEvidence(path: string | undefined, value: unknown): void {
  if (path === undefined || path.length === 0) {
    throw new Error("--output is required.");
  }
  const resolved = isAbsolute(path) ? path : resolve(repoRoot, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
