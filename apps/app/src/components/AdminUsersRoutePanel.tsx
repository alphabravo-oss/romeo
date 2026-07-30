import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { UsersPanel } from "./admin-lazy-panels";

export type AdminUserSort = "email" | "name" | "role" | "status";

interface AdminUsersRoutePanelProps {
  direction: string | undefined;
  page: number | undefined;
  query: string | undefined;
  sort: string | undefined;
}

const userSorts: readonly AdminUserSort[] = ["email", "name", "role", "status"];

export function AdminUsersRoutePanel({
  direction,
  page,
  query,
  sort,
}: AdminUsersRoutePanelProps) {
  const navigate = useNavigate({ from: "/admin" });
  const updateUserSearch = useCallback(
    (next: {
      direction?: "asc" | "desc";
      page?: number;
      query?: string;
      sort?: AdminUserSort;
    }) =>
      void navigate({
        search: (previous) => ({
          ...previous,
          section: "users",
          ...next,
        }),
      }),
    [navigate],
  );

  return (
    <UsersPanel
      direction={direction === "desc" ? "desc" : "asc"}
      onNavigationChange={updateUserSearch}
      page={page ?? 0}
      query={query ?? ""}
      sort={
        userSorts.includes(sort as AdminUserSort)
          ? (sort as AdminUserSort)
          : "name"
      }
    />
  );
}
