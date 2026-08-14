import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  auditRouteSearchFields,
  resolveAuditRouteState,
  type AuditRouteState,
} from "../lib/audit-route-state";
import { AuditPanel } from "./admin-lazy-panels";

export function AdminAuditRoutePanel() {
  const search = useSearch({ from: "/admin" });
  const navigate = useNavigate({ from: "/admin" });
  const routeState = resolveAuditRouteState(search);
  const updateRouteState = useCallback(
    (next: AuditRouteState, options?: { replace?: boolean }) =>
      void navigate({
        ...(options?.replace === undefined ? {} : { replace: options.replace }),
        search: (previous) => {
          const {
            auditCategory: _auditCategory,
            auditNoise: _auditNoise,
            auditOutcome: _auditOutcome,
            auditPageSize: _auditPageSize,
            auditRange: _auditRange,
            auditSort: _auditSort,
            ...rest
          } = previous;
          return {
            ...rest,
            section: "audit",
            ...auditRouteSearchFields(next),
          };
        },
      }),
    [navigate],
  );
  return (
    <AuditPanel onRouteStateChange={updateRouteState} routeState={routeState} />
  );
}
