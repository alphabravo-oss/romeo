import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import type { SamlProviderLoginConfig } from "./auth-provider-settings-service";
import { writeAuditLog } from "./audit-log";
import { stableHash } from "./saml-auth-helpers";
import { ensureSystemAuditActor } from "./system-audit-actor";

export async function auditSamlSuccess(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: {
    config: SamlProviderLoginConfig;
    groupCount: number;
    mappedGroupCount: number;
    subject: string;
    userId: string;
  },
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action: "auth.saml.login.success",
    resourceType: "user",
    resourceId: input.userId,
    metadata: {
      adminGroupPolicyActive: input.config.adminGroups.length > 0,
      allowedDomainPolicyActive: input.config.allowedEmailDomains.length > 0,
      groupCount: input.groupCount,
      mappedGroupCount: input.mappedGroupCount,
      providerId: input.config.providerId,
      requiredGroupCount: input.config.requiredGroups.length,
      signedAssertionRequired: true,
      signedResponseRequired: input.config.wantAuthnResponseSigned,
      subjectHash: stableHash(input.subject),
    },
  });
}

export async function auditSamlFailure(
  repository: RomeoRepository,
  input: {
    failureClass: string;
    orgId: string;
    providerId: "saml";
    requestId?: string;
  },
): Promise<void> {
  const actor = await ensureSystemAuditActor(repository, {
    kind: "saml_auth",
    name: "SAML Auth Audit Actor",
    orgId: input.orgId,
  });
  await writeAuditLog(repository, {
    id: createId("audit"),
    orgId: input.orgId,
    actorId: actor.id,
    action: "auth.saml.login.failure",
    resourceType: "auth_provider",
    resourceId: input.providerId,
    outcome: "failure",
    metadata: {
      failureClass: input.failureClass,
      providerId: input.providerId,
      ...(input.requestId === undefined
        ? {}
        : { requestIdHash: stableHash(input.requestId) }),
    },
    createdAt: new Date().toISOString(),
  });
}
