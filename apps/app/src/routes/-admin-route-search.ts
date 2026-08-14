import type { AuditRouteSearchFields } from "../lib/audit-route-state";
import { validatedWorkspaceRouteSearch } from "../lib/route-workspace-selection";

export interface AdminSearch extends AuditRouteSearchFields {
  availability?: string;
  connection?: string;
  direction?: string;
  managedModel?: string;
  managedModelTab?: string;
  model?: string;
  page?: number;
  provider?: string;
  query?: string;
  section?: string;
  sort?: string;
  toolConnector?: string;
  view?: string;
  workspace?: string;
}

export function validateAdminSearch(
  search: Record<string, unknown>,
): AdminSearch {
  return {
    ...(typeof search.auditCategory === "string"
      ? { auditCategory: search.auditCategory }
      : {}),
    ...(typeof search.auditNoise === "boolean"
      ? { auditNoise: search.auditNoise }
      : {}),
    ...(typeof search.auditOutcome === "string"
      ? { auditOutcome: search.auditOutcome }
      : {}),
    ...(typeof search.auditPageSize === "number" &&
    Number.isInteger(search.auditPageSize)
      ? { auditPageSize: search.auditPageSize }
      : {}),
    ...(typeof search.auditRange === "string"
      ? { auditRange: search.auditRange }
      : {}),
    ...(typeof search.auditSort === "string"
      ? { auditSort: search.auditSort }
      : {}),
    ...(typeof search.section === "string" ? { section: search.section } : {}),
    ...(typeof search.view === "string" ? { view: search.view } : {}),
    ...validatedWorkspaceRouteSearch(search.workspace),
    ...(typeof search.query === "string" ? { query: search.query } : {}),
    ...(typeof search.provider === "string"
      ? { provider: search.provider }
      : {}),
    ...(typeof search.availability === "string"
      ? { availability: search.availability }
      : {}),
    ...(typeof search.connection === "string"
      ? { connection: search.connection }
      : {}),
    ...(typeof search.direction === "string"
      ? { direction: search.direction }
      : {}),
    ...(typeof search.managedModel === "string"
      ? { managedModel: search.managedModel }
      : {}),
    ...(typeof search.managedModelTab === "string"
      ? { managedModelTab: search.managedModelTab }
      : {}),
    ...(typeof search.model === "string" ? { model: search.model } : {}),
    ...(typeof search.sort === "string" ? { sort: search.sort } : {}),
    ...(typeof search.toolConnector === "string"
      ? { toolConnector: search.toolConnector }
      : {}),
    ...(typeof search.page === "number" && Number.isInteger(search.page)
      ? { page: Math.max(0, search.page) }
      : {}),
  };
}
