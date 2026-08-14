import type { AuditLog } from "./domain/entities";
import {
  isPrivacySafeMetadataKey,
  isPrivacySafeMetadataValue,
  isPrivacySafeString,
} from "./metadata-privacy";
import { auditActionsByCategory } from "./audit-action-inventory";
import { canonicalAuditMetadataKeysByAction } from "./audit-canonical-metadata-inventory";
import { auditMetadataKeysByAction } from "./audit-metadata-inventory";

export const auditTaxonomyCategories = [
  "security",
  "admin",
  "access",
  "data",
  "chat",
  "run",
  "system",
] as const;
export type AuditTaxonomyCategory = (typeof auditTaxonomyCategories)[number];
type ActionInventory = typeof auditActionsByCategory;
export type AuditAction = {
  [Category in keyof ActionInventory]: ActionInventory[Category][number];
}[keyof ActionInventory];

type BaseAuditMetadataKey<A extends AuditAction> =
  (typeof auditMetadataKeysByAction)[A][number];
type CanonicalAuditMetadataKey<A extends AuditAction> =
  A extends keyof typeof canonicalAuditMetadataKeysByAction
    ? (typeof canonicalAuditMetadataKeysByAction)[A][number]
    : never;
export type AuditMetadataKey<A extends AuditAction> =
  | BaseAuditMetadataKey<A>
  | CanonicalAuditMetadataKey<A>
  | keyof typeof telemetryMetadata;
export type AuditMetadataValue = unknown;
export type AuditMetadata<A extends AuditAction> = Partial<
  Record<AuditMetadataKey<A>, AuditMetadataValue>
>;

export type AuditMetadataValueClass =
  | "bounded_list"
  | "bounded_scalar"
  | "bounded_summary"
  | "identifier"
  | "timestamp";
export type AuditSemantic =
  | "acl_filtering"
  | "compare"
  | "compute_or_tool"
  | "encryption"
  | "lifecycle"
  | "media"
  | "policy_decision"
  | "provider_routing"
  | "start";

export interface AuditActionDefinition {
  action: string;
  allowedMetadata: Readonly<Record<string, AuditMetadataValueClass>>;
  category: AuditTaxonomyCategory;
  redaction: "reject_forbidden";
  requiredContext: readonly (
    | "actor"
    | "organization"
    | "outcome"
    | "resource"
  )[];
  resourceSemantics: string;
  semantic: AuditSemantic;
  sensitivity: "metadata_only";
}

const telemetryMetadata = {
  requestId: "identifier",
  traceId: "identifier",
} as const satisfies Record<string, AuditMetadataValueClass>;

export const auditActionRegistry = Object.freeze(
  Object.fromEntries(
    Object.entries(auditActionsByCategory).flatMap(([category, actions]) =>
      actions.map((action) => [
        action,
        Object.freeze({
          action,
          allowedMetadata: Object.freeze({
            ...telemetryMetadata,
            ...Object.fromEntries(
              registeredMetadataKeys(action).map((key) => [
                key,
                metadataValueClass(key),
              ]),
            ),
          }),
          category: category as AuditTaxonomyCategory,
          redaction: "reject_forbidden",
          requiredContext: ["actor", "organization", "outcome", "resource"],
          resourceSemantics: action.split(".")[0] ?? "resource",
          semantic: auditSemantic(action),
          sensitivity: "metadata_only",
        } satisfies AuditActionDefinition),
      ]),
    ),
  ),
) as unknown as Readonly<Record<AuditAction, AuditActionDefinition>>;

export function auditActionDefinition(
  action: string,
): AuditActionDefinition | undefined {
  return (
    auditActionRegistry as Readonly<Record<string, AuditActionDefinition>>
  )[action];
}

export function assertValidAuditLog(log: AuditLog): void {
  const definition = auditActionDefinition(log.action);
  if (definition === undefined)
    throw new TypeError("Audit action is not registered.");
  if (
    !boundedIdentifier(log.orgId) ||
    !boundedIdentifier(log.actorId) ||
    !boundedIdentifier(log.resourceType) ||
    !boundedIdentifier(log.resourceId)
  )
    throw new TypeError("Audit context is invalid.");
  const entries = Object.entries(log.metadata);
  if (entries.length > 100)
    throw new TypeError("Audit metadata exceeds the key limit.");
  for (const [key, value] of entries) {
    if (!isPrivacySafeMetadataKey(key))
      throw new TypeError("Audit metadata contains a forbidden key.");
    const valueClass = definition?.allowedMetadata[key];
    if (valueClass === undefined)
      throw new TypeError("Audit metadata key is not registered.");
    if (!validMetadataValue(value, valueClass, 0))
      throw new TypeError("Audit metadata value is invalid.");
  }
}

function auditSemantic(action: string): AuditSemantic {
  if (/\b(?:share|member|grant|favorite)\b/u.test(action))
    return "acl_filtering";
  if (/\b(?:compare|replay)\b/u.test(action)) return "compare";
  if (/\b(?:secret|rewrap|encrypt|credential|preferences)\b/u.test(action))
    return "encryption";
  if (/^(?:tool|workflow|worker|run)\./u.test(action)) return "compute_or_tool";
  if (/^(?:voice|image|file|artifact)\./u.test(action)) return "media";
  if (/^(?:model\.request|provider\.)/u.test(action)) return "provider_routing";
  if (/(?:policy|capability|enforcement|approval)/u.test(action))
    return "policy_decision";
  if (/\b(?:start|create|enqueue|request)$/u.test(action)) return "start";
  return "lifecycle";
}

function registeredMetadataKeys(action: AuditAction): readonly string[] {
  const canonical = canonicalAuditMetadataKeysByAction as Partial<
    Record<AuditAction, readonly string[]>
  >;
  return [
    ...new Set([
      ...auditMetadataKeysByAction[action],
      ...(canonical[action] ?? []),
    ]),
  ];
}

function metadataValueClass(key: string): AuditMetadataValueClass {
  if (key.endsWith("At") || key.endsWith("Until")) return "timestamp";
  if (key.endsWith("Ids")) return "bounded_list";
  if (key.endsWith("Id")) return "identifier";
  if (/(?:Fields|Keys|Permissions|Reasons|Scopes|Statuses|Types)$/u.test(key))
    return "bounded_list";
  if (/(?:Counts|Summary|Skipped)$/u.test(key)) return "bounded_summary";
  return "bounded_scalar";
}

function validMetadataValue(
  value: unknown,
  _valueClass: AuditMetadataValueClass,
  depth: number,
): boolean {
  if (value === undefined || value === null) return true;
  return isPrivacySafeMetadataValue(value, depth);
}

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && isPrivacySafeString(value)
  );
}
