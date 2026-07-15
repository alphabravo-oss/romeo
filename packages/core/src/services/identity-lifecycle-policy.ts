import type {
  AccessReviewPolicyPosture,
  IdentityLifecyclePolicy,
} from "../domain/entities";

export interface IdentityLifecyclePolicyOptions {
  scimEnabled?: boolean | undefined;
}

export function accessReviewPolicyPosture(
  options: IdentityLifecyclePolicyOptions = {},
): AccessReviewPolicyPosture {
  return {
    accountLinking: "disabled",
    scim: options.scimEnabled === true ? "enabled" : "disabled",
    localAdminSource: "local",
    oidcGroupSync: "additive_known_groups_only",
    destructiveMembershipSync: "disabled",
    supportAccess: "time_bound_approved_audited",
  };
}

export function buildIdentityLifecyclePolicy(
  orgId: string,
  options: IdentityLifecyclePolicyOptions = {},
): IdentityLifecyclePolicy {
  const scimEnabled = options.scimEnabled === true;
  return {
    schema: "romeo.identity-lifecycle-policy.v1",
    orgId,
    generatedAt: new Date().toISOString(),
    policy: accessReviewPolicyPosture({ scimEnabled }),
    accountLinking: {
      status: "disabled",
      rationale:
        "Romeo does not link local accounts to incoming external identities. Matching emails or cross-org issuer/subject collisions fail closed.",
    },
    scim: {
      status: scimEnabled ? "enabled" : "disabled",
      supportedResources: scimEnabled ? ["User", "Group"] : [],
      rationale: scimEnabled
        ? "SCIM v2 Users and Groups endpoints are enabled for admin-scoped service-account or API-key clients. User deletes deactivate accounts and revoke credentials; group deletes remove memberships and revoke group-principal grants before deleting the group."
        : "SCIM is disabled until SCIM_ENABLED=true is set for a deployment that accepts supported resources, patch semantics, idempotency, auth, and destructive-change safeguards.",
    },
    groupLifecycle: {
      localAdminSource: "local",
      oidcGroupSync: "additive_known_groups_only",
      destructiveMembershipSync: "disabled",
      unknownExternalGroups: "ignored",
    },
    deprovisioning: {
      localUserDisable: "revokes_user_api_keys_and_sessions",
      oidcFeed: "admin_confirmed_issuer_subject",
      supportAccess: "time_bound_approved_audited_revocable",
    },
  };
}
