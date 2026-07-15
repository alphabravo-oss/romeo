import type { ObjectStore } from "@romeo/storage";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { ToolOperationDispatchPayloadStoreReference } from "../domain/entities";
import { createId } from "../ids";

export const toolDispatchPayloadSchemaVersion =
  "romeo.tool-dispatch-payload.v1";
export const toolDispatchPayloadContentType =
  "application/vnd.romeo.tool-dispatch-payload+json";

export type ToolDispatchPayloadAuth =
  | {
      secretRef: string;
      type: "bearer";
    }
  | {
      apiKeyIn?: "header" | "query";
      apiKeyName?: string;
      secretRef: string;
      type: "api_key";
    }
  | {
      secretRef: string;
      type: "oauth2_client_credentials";
    };

export interface ToolDispatchPayload {
  auth?: ToolDispatchPayloadAuth;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  parameters?: Record<string, unknown>;
}

export interface StoreToolDispatchPayloadInput {
  actorId: string;
  connectorId: string;
  operationId: string;
  orgId: string;
  payload: ToolDispatchPayload;
}

export interface StoredToolDispatchPayload {
  actorId: string;
  connectorId: string;
  createdAt: string;
  operationId: string;
  orgId: string;
  payload: ToolDispatchPayload;
  schemaVersion: typeof toolDispatchPayloadSchemaVersion;
}

export interface ToolDispatchPayloadStore {
  delete(reference: ToolOperationDispatchPayloadStoreReference): Promise<void>;
  read(
    reference: ToolOperationDispatchPayloadStoreReference,
  ): Promise<StoredToolDispatchPayload | undefined>;
  store(
    input: StoreToolDispatchPayloadInput,
  ): Promise<ToolOperationDispatchPayloadStoreReference>;
}

export class EncryptedObjectToolDispatchPayloadStore
  implements ToolDispatchPayloadStore
{
  private readonly key: Buffer;
  private readonly prefix: string;

  constructor(
    private readonly objectStore: ObjectStore,
    config: { encryptionKey: string; prefix: string },
  ) {
    this.key = deriveEncryptionKey(config.encryptionKey);
    this.prefix = normalizeObjectKeyPrefix(config.prefix);
  }

  async store(
    input: StoreToolDispatchPayloadInput,
  ): Promise<ToolOperationDispatchPayloadStoreReference> {
    const objectKey = [
      this.prefix,
      safeObjectKeySegment(input.orgId),
      `${createId("tool_payload")}.json.enc`,
    ].join("/");
    const envelope = encryptPayload({
      key: this.key,
      objectKey,
      plaintext: {
        actorId: input.actorId,
        connectorId: input.connectorId,
        createdAt: new Date().toISOString(),
        operationId: input.operationId,
        orgId: input.orgId,
        payload: input.payload,
        schemaVersion: toolDispatchPayloadSchemaVersion,
      },
    });
    await this.objectStore.putObject({
      key: objectKey,
      body: Buffer.from(JSON.stringify(envelope), "utf8"),
      contentType: toolDispatchPayloadContentType,
    });
    return {
      contentType: toolDispatchPayloadContentType,
      driver: "object_store",
      encrypted: true,
      objectKey,
      schemaVersion: toolDispatchPayloadSchemaVersion,
    };
  }

  async delete(
    reference: ToolOperationDispatchPayloadStoreReference,
  ): Promise<void> {
    await this.objectStore.deleteObject(reference.objectKey);
  }

  async read(
    reference: ToolOperationDispatchPayloadStoreReference,
  ): Promise<StoredToolDispatchPayload | undefined> {
    const bytes = await this.objectStore.getObject(reference.objectKey);
    if (bytes === undefined) return undefined;
    const envelope = parseEncryptedEnvelope(new TextDecoder().decode(bytes));
    const plaintext = decryptPayload({
      key: this.key,
      objectKey: reference.objectKey,
      envelope,
    });
    return readStoredPayload(plaintext);
  }
}

export function isToolDispatchPayloadStoreReference(
  value: unknown,
): value is ToolOperationDispatchPayloadStoreReference {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    record.contentType === toolDispatchPayloadContentType &&
    record.driver === "object_store" &&
    record.encrypted === true &&
    typeof record.objectKey === "string" &&
    record.objectKey.length > 0 &&
    record.schemaVersion === toolDispatchPayloadSchemaVersion
  );
}

function encryptPayload(input: {
  key: Buffer;
  objectKey: string;
  plaintext: Record<string, unknown>;
}): {
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  schemaVersion: typeof toolDispatchPayloadSchemaVersion;
  tag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.key, iv);
  cipher.setAAD(payloadAad(input.objectKey));
  const plaintext = Buffer.from(JSON.stringify(input.plaintext), "utf8");
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    schemaVersion: toolDispatchPayloadSchemaVersion,
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function decryptPayload(input: {
  key: Buffer;
  objectKey: string;
  envelope: {
    algorithm: "aes-256-gcm";
    ciphertext: string;
    iv: string;
    schemaVersion: typeof toolDispatchPayloadSchemaVersion;
    tag: string;
  };
}): unknown {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    input.key,
    Buffer.from(input.envelope.iv, "base64url"),
  );
  decipher.setAAD(payloadAad(input.objectKey));
  decipher.setAuthTag(Buffer.from(input.envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function parseEncryptedEnvelope(text: string): {
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  schemaVersion: typeof toolDispatchPayloadSchemaVersion;
  tag: string;
} {
  const value = JSON.parse(text) as unknown;
  const record = asRecord(value);
  if (
    record === undefined ||
    record.algorithm !== "aes-256-gcm" ||
    record.schemaVersion !== toolDispatchPayloadSchemaVersion ||
    typeof record.ciphertext !== "string" ||
    typeof record.iv !== "string" ||
    typeof record.tag !== "string"
  ) {
    throw new Error("tool_dispatch_payload_store_invalid");
  }
  return {
    algorithm: "aes-256-gcm",
    ciphertext: record.ciphertext,
    iv: record.iv,
    schemaVersion: toolDispatchPayloadSchemaVersion,
    tag: record.tag,
  };
}

function readStoredPayload(value: unknown): StoredToolDispatchPayload {
  const record = asRecord(value);
  const payload = asRecord(record?.payload);
  if (
    record === undefined ||
    payload === undefined ||
    record.schemaVersion !== toolDispatchPayloadSchemaVersion ||
    typeof record.actorId !== "string" ||
    typeof record.connectorId !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.operationId !== "string" ||
    typeof record.orgId !== "string"
  ) {
    throw new Error("tool_dispatch_payload_store_invalid");
  }
  return {
    actorId: record.actorId,
    connectorId: record.connectorId,
    createdAt: record.createdAt,
    operationId: record.operationId,
    orgId: record.orgId,
    payload: readToolDispatchPayload(payload),
    schemaVersion: toolDispatchPayloadSchemaVersion,
  };
}

function readToolDispatchPayload(
  record: Record<string, unknown>,
): ToolDispatchPayload {
  const payload: ToolDispatchPayload = {};
  const auth = readToolDispatchPayloadAuth(record.auth);
  const body = readUnknownRecord(record.body);
  const headers = readStringRecord(record.headers);
  const parameters = readUnknownRecord(record.parameters);
  if (auth !== undefined) payload.auth = auth;
  if (body !== undefined) payload.body = body;
  if (headers !== undefined) payload.headers = headers;
  if (parameters !== undefined) payload.parameters = parameters;
  return payload;
}

function readToolDispatchPayloadAuth(
  value: unknown,
): ToolDispatchPayloadAuth | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record.type !== "string" ||
    typeof record.secretRef !== "string"
  ) {
    throw new Error("tool_dispatch_payload_store_invalid");
  }
  if (record.type === "bearer") {
    return { secretRef: record.secretRef, type: "bearer" };
  }
  if (record.type === "api_key") {
    const auth: ToolDispatchPayloadAuth = {
      secretRef: record.secretRef,
      type: "api_key",
    };
    if (record.apiKeyIn === "header" || record.apiKeyIn === "query")
      auth.apiKeyIn = record.apiKeyIn;
    if (typeof record.apiKeyName === "string")
      auth.apiKeyName = record.apiKeyName;
    return auth;
  }
  if (record.type === "oauth2_client_credentials") {
    return {
      secretRef: record.secretRef,
      type: "oauth2_client_credentials",
    };
  }
  throw new Error("tool_dispatch_payload_store_invalid");
}

function readUnknownRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (record === undefined) throw new Error("tool_dispatch_payload_store_invalid");
  return record;
}

function readStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (
    record === undefined ||
    !Object.values(record).every((item) => typeof item === "string")
  ) {
    throw new Error("tool_dispatch_payload_store_invalid");
  }
  return record as Record<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function payloadAad(objectKey: string): Buffer {
  return Buffer.from(`${toolDispatchPayloadSchemaVersion}\0${objectKey}`, "utf8");
}

function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256")
    .update("romeo.tool-dispatch-payload.key.v1")
    .update("\0")
    .update(secret)
    .digest();
}

function normalizeObjectKeyPrefix(prefix: string): string {
  const parts = prefix
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("tool_dispatch_payload_prefix_invalid");
  }
  return parts.length === 0 ? "tool-dispatch-payloads/v1" : parts.join("/");
}

function safeObjectKeySegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 120) || "unknown";
}
