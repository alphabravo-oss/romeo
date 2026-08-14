import type { AuditAction } from "../audit-taxonomy";

/**
 * Protected mutations that must emit a registered audit action. Adding a
 * critical action here fails CI unless a production `writeAuditLog` site
 * still writes that exact action.
 */
export const CRITICAL_AUDIT_ACTIONS = [
  "admin.capability_assignment.replace",
  "admin.capability_flag.replace",
  "admin.content_policy.version.publish",
  "admin.managed_secret.create",
  "admin.organization.deletion_request",
  "admin.organization.suspend",
  "admin.policy_bundle.approve",
  "local_auth.mfa.disable",
  "provider.create",
  "provider.update",
  "support.impersonation.create",
  "support.impersonation.request.approve",
  "support.impersonation.revoke",
] as const satisfies readonly AuditAction[];

export type CriticalAuditAction = (typeof CRITICAL_AUDIT_ACTIONS)[number];

export function missingCriticalAuditWrites(
  writtenActions: ReadonlySet<string>,
): CriticalAuditAction[] {
  return CRITICAL_AUDIT_ACTIONS.filter((action) => !writtenActions.has(action));
}
