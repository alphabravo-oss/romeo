import { isAdminForOrg, type AuthSubject } from "@romeo/auth";

import type { ServiceAccount } from "../domain/entities";

export function canManageServiceAccount(
  subject: AuthSubject,
  serviceAccount: ServiceAccount,
): boolean {
  return (
    isAdminForOrg(subject, serviceAccount.orgId) ||
    serviceAccount.createdBy === subject.id
  );
}

export function filterVisibleServiceAccounts(
  subject: AuthSubject,
  serviceAccounts: ServiceAccount[],
): ServiceAccount[] {
  if (subject.isAdmin === true)
    return serviceAccounts.filter((serviceAccount) =>
      isAdminForOrg(subject, serviceAccount.orgId),
    );
  return serviceAccounts.filter(
    (serviceAccount) => serviceAccount.createdBy === subject.id,
  );
}
