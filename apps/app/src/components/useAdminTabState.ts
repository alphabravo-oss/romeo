import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import type { RoutedTabsState } from "./Tabs";

export function useAdminTabState(search: {
  subtab?: string;
  tab?: string;
}): RoutedTabsState {
  const navigate = useNavigate({ from: "/admin" });
  const onActiveIdChange = useCallback(
    (tab: string) => {
      void navigate({
        search: (previous) => {
          const { subtab: _subtab, ...rest } = previous;
          return {
            ...rest,
            tab,
            ...(tab === "governance" && search.subtab !== undefined
              ? { subtab: search.subtab }
              : {}),
          };
        },
      });
    },
    [navigate, search.subtab],
  );
  const onSecondaryActiveIdChange = useCallback(
    (subtab: string) => {
      void navigate({
        search: (previous) => ({ ...previous, subtab }),
      });
    },
    [navigate],
  );
  return {
    ...(search.tab === undefined ? {} : { activeId: search.tab }),
    ...(search.subtab === undefined
      ? {}
      : { secondaryActiveId: search.subtab }),
    onActiveIdChange,
    onSecondaryActiveIdChange,
  };
}
