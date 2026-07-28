import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Group, User } from "../domain/entities";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { normalizeLocalAuthEmail } from "./local-password";

export interface ScimListQuery {
  filter?: string | undefined;
  startIndex?: number | undefined;
  count?: number | undefined;
}

export interface ScimCreateUserInput {
  userName?: string | undefined;
  displayName?: string | undefined;
  name?:
    | {
        formatted?: string | undefined;
        givenName?: string | undefined;
        familyName?: string | undefined;
      }
    | undefined;
  emails?:
    | {
        value?: string | undefined;
        primary?: boolean | undefined;
        type?: string | undefined;
      }[]
    | undefined;
  active?: boolean | undefined;
}

export interface ScimCreateGroupInput {
  displayName?: string | undefined;
  members?: { value?: string | undefined }[] | undefined;
}

export interface ScimPatchInput {
  Operations?: ScimPatchOperation[];
}

export interface ScimPatchOperation {
  op?: string | undefined;
  path?: string | undefined;
  value?: unknown;
}

export interface NormalizedPatchOperation {
  op: string;
  path?: string | undefined;
  value?: unknown;
}

export interface ScimOptions {
  enabled: boolean;
}

export interface Page {
  startIndex: number;
  count: number;
}

export interface ParsedFilter {
  attribute: string;
  value: string;
}

export function scimError(
  message: string,
  status: ContentfulStatusCode,
  scimType?: string,
): ApiError {
  return new ApiError("scim_error", message, status, {
    scimType,
    scimStatus: String(status),
  });
}

export function normalizeScimUserEmail(input: ScimCreateUserInput): string {
  const email =
    input.userName ??
    input.emails?.find((email) => email.primary === true)?.value ??
    input.emails?.[0]?.value;
  if (email === undefined) {
    throw scimError(
      "SCIM user requires userName or an email value.",
      400,
      "invalidValue",
    );
  }
  return normalizeLocalAuthEmail(email);
}

export function normalizeScimUserName(
  input: ScimCreateUserInput,
  fallback: string,
): string {
  const structuredName = [input.name?.givenName, input.name?.familyName]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  const candidate =
    input.displayName ??
    input.name?.formatted ??
    (structuredName.length > 0 ? structuredName : undefined) ??
    fallback;
  return boundedText(candidate, 1, 200);
}

export function normalizePatchOperations(
  input: ScimPatchInput,
): NormalizedPatchOperation[] {
  const operations = input.Operations;
  if (
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > 100
  ) {
    throw scimError(
      "SCIM PatchOp requires 1-100 operations.",
      400,
      "invalidSyntax",
    );
  }
  return operations.map((operation) => {
    if (typeof operation.op !== "string" || operation.op.trim().length === 0) {
      throw scimError(
        "SCIM PatchOp operation is missing op.",
        400,
        "invalidSyntax",
      );
    }
    return {
      op: operation.op.trim(),
      path: operation.path,
      value: operation.value,
    };
  });
}

export function applyUserActive(user: User, active: boolean): User {
  if (active) {
    const { disabledAt: _disabledAt, ...enabledUser } = user;
    return enabledUser;
  }
  return { ...user, disabledAt: user.disabledAt ?? new Date().toISOString() };
}

export function boundedText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") {
    throw scimError("SCIM text value is invalid.", 400, "invalidValue");
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw scimError(
      "SCIM text value is outside allowed bounds.",
      400,
      "invalidValue",
    );
  }
  return text;
}

export function stringValue(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (isObjectRecord(value) && typeof value.value === "string")
    return value.value;
  throw scimError(`${label} must be a string.`, 400, "invalidValue");
}

export function pageFromQuery(query: ScimListQuery): Page {
  const startIndex = clampInteger(query.startIndex ?? 1, 1, 1_000_000);
  const count = clampInteger(query.count ?? 100, 0, 200);
  return { startIndex, count };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function parseFilter(
  filter: string | undefined,
): ParsedFilter | undefined {
  if (filter === undefined || filter.trim().length === 0) return undefined;
  const match = /^\s*([A-Za-z.]+)\s+eq\s+"([^"]{1,320})"\s*$/u.exec(filter);
  if (!match) throw scimError("Unsupported SCIM filter.", 400, "invalidFilter");
  return { attribute: match[1]!.toLowerCase(), value: match[2]! };
}

export function userMatchesFilter(
  user: User,
  filter: ParsedFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.attribute === "id") return user.id === filter.value;
  if (filter.attribute === "username" || filter.attribute === "emails.value") {
    return (
      normalizeLocalAuthEmail(user.email) ===
      normalizeLocalAuthEmail(filter.value)
    );
  }
  if (filter.attribute === "displayname") return user.name === filter.value;
  throw scimError("Unsupported SCIM user filter.", 400, "invalidFilter");
}

export function groupMatchesFilter(
  group: Group,
  filter: ParsedFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.attribute === "id") return group.id === filter.value;
  if (filter.attribute === "displayname") return group.name === filter.value;
  throw scimError("Unsupported SCIM group filter.", 400, "invalidFilter");
}

export function memberValues(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input))
    throw scimError("SCIM members must be an array.", 400, "invalidValue");
  return input.map((member) => {
    if (!isObjectRecord(member) || typeof member.value !== "string") {
      throw scimError("SCIM member value is invalid.", 400, "invalidValue");
    }
    return boundedText(member.value, 1, 120);
  });
}

export function memberValuesFromRemove(
  operation: ScimPatchOperation,
): string[] {
  const pathMatch = /^members\s*\[\s*value\s+eq\s+"([^"]{1,120})"\s*\]$/iu.exec(
    operation.path ?? "",
  );
  if (pathMatch) return [pathMatch[1]!];
  if (operation.value !== undefined) return memberValues(operation.value);
  throw scimError(
    "SCIM member remove requires a value filter or members value.",
    400,
    "invalidValue",
  );
}

export function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug.length === 0 ? `scim_${createId("group").slice(-10)}` : slug;
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
