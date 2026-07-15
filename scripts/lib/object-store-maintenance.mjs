import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

export function argInteger(name, fallback) {
  const value = argValue(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

export function repoPath(path) {
  return resolve(repoRoot, path);
}

export function resolveRepoPath(path) {
  return path.startsWith("/") ? path : repoPath(path);
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function ensureParentDirectory(path) {
  mkdirSync(dirname(path), { recursive: true });
}

export function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function readSourceObjectStoreConfig() {
  return readObjectStoreConfig("");
}

export function readRestoreObjectStoreConfig() {
  return readObjectStoreConfig("RESTORE_");
}

export function redactedObjectStore(config) {
  return {
    endpoint: redactUrl(config.endpoint),
    bucket: config.bucket,
    region: config.region,
    accessKeyId: redactValue(config.accessKeyId),
  };
}

export function printPlan(plan) {
  console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
}

export async function listObjects(config, options = {}) {
  const prefix = options.prefix ?? "";
  const maxKeys = options.maxKeys ?? 1000;
  const objects = [];
  let continuationToken;

  do {
    const query = {
      "list-type": "2",
      "max-keys": String(Math.min(Math.max(maxKeys, 1), 1000)),
      ...(prefix.length === 0 ? {} : { prefix }),
      ...(continuationToken === undefined
        ? {}
        : { "continuation-token": continuationToken }),
    };
    const signed = await createS3SignedRequest({
      ...config,
      key: "",
      method: "GET",
      query,
    });
    const response = await fetch(signed.url, { headers: signed.headers });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `Object listing failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    const page = parseListObjectsV2(text);
    objects.push(...page.objects);
    continuationToken = page.nextContinuationToken;
  } while (continuationToken !== undefined);

  return objects;
}

export async function downloadObject(config, object, destination) {
  const signed = await createS3PresignedRequest({
    ...config,
    expiresInSeconds: 300,
    key: object.key,
    method: "GET",
  });
  const response = await fetch(signed.url, { headers: signed.headers });
  if (!response.ok || response.body === null)
    throw new Error(
      `Object download failed for ${object.key} with HTTP ${response.status}.`,
    );
  ensureParentDirectory(destination);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
  const stat = statSync(destination);
  return {
    key: object.key,
    file: destination,
    bytes: stat.size,
    sha256: await sha256File(destination),
    contentType: response.headers.get("content-type") ?? object.contentType,
    etag: trimEtag(response.headers.get("etag") ?? object.etag),
    lastModified: response.headers.get("last-modified") ?? object.lastModified,
  };
}

export async function uploadObject(config, object) {
  const stat = statSync(object.file);
  const signed = await createS3PresignedRequest({
    ...config,
    contentType: object.contentType,
    expiresInSeconds: 300,
    key: object.key,
    method: "PUT",
  });
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: { ...signed.headers, "content-length": String(stat.size) },
    body: createReadStream(object.file),
    duplex: "half",
  });
  const text = response.ok ? "" : await response.text();
  if (!response.ok)
    throw new Error(
      `Object restore failed for ${object.key} with HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  return {
    key: object.key,
    bytes: stat.size,
    sha256: await sha256File(object.file),
    contentType: object.contentType,
    etag: trimEtag(response.headers.get("etag")),
  };
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      yield chunk;
    }
  });
  return hash.digest("hex");
}

export async function assertFileSha256(path, expectedSha256) {
  if (expectedSha256 === undefined) return;
  const actualSha256 = await sha256File(path);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${path}. Expected ${expectedSha256}, got ${actualSha256}.`,
    );
  }
}

export function manifestObjectPath(outputDir, index, key) {
  return join(
    outputDir,
    "objects",
    `${String(index + 1).padStart(6, "0")}-${Buffer.from(key).toString("base64url")}.bin`,
  );
}

export function relativeManifestPath(path, basePath) {
  return path.startsWith(`${basePath}/`)
    ? path.slice(basePath.length + 1)
    : path;
}

export function manifestObjectAbsolutePath(manifestPath, objectFile) {
  return objectFile.startsWith("/")
    ? objectFile
    : join(dirname(manifestPath), objectFile);
}

export function validateObjectStoreManifest(manifest) {
  if (manifest?.schemaVersion !== "romeo.object-store-backup.v1") {
    throw new Error(
      "Object-store manifest schemaVersion must be romeo.object-store-backup.v1.",
    );
  }
  if (!Array.isArray(manifest.objects))
    throw new Error("Object-store manifest must include an objects array.");
  for (const object of manifest.objects) {
    if (typeof object.key !== "string" || object.key.length === 0)
      throw new Error("Object manifest entries require key.");
    if (typeof object.file !== "string" || object.file.length === 0)
      throw new Error(`Object ${object.key} is missing file.`);
    if (!Number.isInteger(object.bytes) || object.bytes < 0)
      throw new Error(`Object ${object.key} has invalid byte count.`);
    if (
      typeof object.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(object.sha256)
    )
      throw new Error(`Object ${object.key} has invalid sha256.`);
    if (
      object.contentType !== undefined &&
      typeof object.contentType !== "string"
    )
      throw new Error(`Object ${object.key} has invalid contentType.`);
  }
}

export function parseListObjectsV2(xml) {
  const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)].map(
    (match) => match[1],
  );
  const objects = contents.map((content) => ({
    key: decodeXml(requiredXmlValue(content, "Key")),
    bytes: Number.parseInt(xmlValue(content, "Size") ?? "0", 10),
    etag: trimEtag(decodeXml(xmlValue(content, "ETag") ?? "")),
    lastModified: decodeXml(xmlValue(content, "LastModified") ?? ""),
  }));
  const nextContinuationToken = xmlValue(xml, "NextContinuationToken");
  return {
    objects,
    nextContinuationToken:
      nextContinuationToken === undefined
        ? undefined
        : decodeXml(nextContinuationToken),
  };
}

export function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.username.length > 0) url.username = "redacted";
    if (url.password.length > 0) url.password = "redacted";
    for (const key of [...url.searchParams.keys()]) {
      if (/secret|signature|token|key|credential|password/iu.test(key))
        url.searchParams.set(key, "redacted");
    }
    return url.toString();
  } catch {
    return redactValue(value);
  }
}

function readObjectStoreConfig(prefix) {
  return {
    endpoint: requiredEnv(`${prefix}S3_ENDPOINT`),
    bucket: requiredEnv(`${prefix}S3_BUCKET`),
    region: nonEmpty(process.env[`${prefix}S3_REGION`]) ?? "us-east-1",
    accessKeyId: requiredEnv(`${prefix}S3_ACCESS_KEY_ID`),
    secretAccessKey: requiredEnv(`${prefix}S3_SECRET_ACCESS_KEY`),
  };
}

function requiredEnv(name) {
  const value = nonEmpty(process.env[name]);
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

function nonEmpty(value) {
  return value === undefined || value.length === 0 ? undefined : value;
}

function redactValue(value) {
  if (value.length <= 6) return "redacted";
  return `${value.slice(0, 3)}...${value.slice(-2)}`;
}

async function createS3PresignedRequest(input) {
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = new URL(input.endpoint);
  const keyPath = input.key.length === 0 ? "" : encodeS3Key(input.key);
  const url = new URL(
    `${trimTrailingSlash(endpoint.toString())}/${encodePathSegment(input.bucket)}/${keyPath}`,
  );
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const signedHeaders = input.contentType ? "content-type;host" : "host";
  const headers = input.contentType
    ? { "content-type": input.contentType }
    : {};
  const query = new Map(signedQueryEntries(input.query));
  query.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  query.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
  query.set("X-Amz-Credential", `${input.accessKeyId}/${scope}`);
  query.set("X-Amz-Date", amzDate);
  query.set("X-Amz-Expires", String(input.expiresInSeconds));
  query.set("X-Amz-SignedHeaders", signedHeaders);
  const canonicalHeaders = input.contentType
    ? `content-type:${input.contentType}\nhost:${url.host}\n`
    : `host:${url.host}\n`;
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await s3SigningKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
  );
  query.set("X-Amz-Signature", toHex(await hmac(signingKey, stringToSign)));
  url.search = canonicalQuery(query);

  return {
    expiresAt: new Date(
      now.getTime() + input.expiresInSeconds * 1000,
    ).toISOString(),
    headers,
    url: url.toString(),
  };
}

async function createS3SignedRequest(input) {
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = new URL(input.endpoint);
  const keyPath = input.key.length === 0 ? "" : encodeS3Key(input.key);
  const url = new URL(
    `${trimTrailingSlash(endpoint.toString())}/${encodePathSegment(input.bucket)}/${keyPath}`,
  );
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const query = new Map(signedQueryEntries(input.query));
  url.search = canonicalQuery(query);

  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await s3SigningKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));

  return {
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    url: url.toString(),
  };
}

function signedQueryEntries(query) {
  if (query === undefined) return [];
  return Object.entries(query)
    .filter((entry) => entry[1] !== undefined)
    .map(([key, value]) => {
      if (key.toLowerCase().startsWith("x-amz-"))
        throw new Error(
          "S3 presigned query cannot override signing parameters.",
        );
      return [key, value];
    });
}

function canonicalQuery(query) {
  return [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

async function s3SigningKey(secretAccessKey, dateStamp, region) {
  const dateKey = await hmac(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp,
  );
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(value),
    ),
  );
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeS3Key(key) {
  return key.split("/").map(encodePathSegment).join("/");
}

function encodePathSegment(value) {
  return encodeRfc3986(value);
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toArrayBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function xmlValue(xml, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "u");
  return xml.match(pattern)?.[1];
}

function requiredXmlValue(xml, tagName) {
  const value = xmlValue(xml, tagName);
  if (value === undefined)
    throw new Error(`S3 ListObjectsV2 response missing ${tagName}.`);
  return value;
}

function decodeXml(value) {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function trimEtag(value) {
  if (value === null || value === undefined || value.length === 0)
    return undefined;
  return value.replace(/^"+|"+$/gu, "");
}
