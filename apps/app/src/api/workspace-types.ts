export interface Workspace {
  id: string;
  orgId?: string;
  name: string;
  slug: string;
  archivedAt?: string;
}

/** Authenticated caller, as returned by GET /api/v1/me. */
export interface Subject {
  id: string;
  type: "user" | "service_account";
  email?: string;
  name?: string;
  orgId: string;
  workspaceIds: string[];
  groupIds: string[];
  scopes: string[];
  isAdmin?: boolean;
}

export interface Bootstrap {
  subject: Subject;
  deployment: {
    tenancyMode: "multi" | "single";
  };
  workspaces: Workspace[];
}

export interface Envelope<T> {
  data: T;
}
