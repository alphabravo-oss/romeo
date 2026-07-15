import type { AuthSubject } from "./types";

export function isGlobalAdmin(subject: AuthSubject): boolean {
  return subject.adminRole === "global_admin";
}

export function isOrgAdmin(subject: AuthSubject): boolean {
  return subject.adminRole === "org_admin";
}

export function canAccessOrg(subject: AuthSubject, orgId: string): boolean {
  return subject.orgId === orgId || isGlobalAdmin(subject);
}

export function isAdminForOrg(subject: AuthSubject, orgId: string): boolean {
  return (
    isGlobalAdmin(subject) ||
    (subject.orgId === orgId && subject.isAdmin === true)
  );
}
