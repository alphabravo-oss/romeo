import type { DataTableAuthority, ServerTableAuthorityScope } from "@romeo/ui";
import { cloneElement, type ReactElement } from "react";

import { useServerTableAuthority } from "../lib/server-table-authority";

export function AuthoritativeDataTable({
  authorityScope,
  children,
  workspaceId,
}: {
  authorityScope: ServerTableAuthorityScope;
  children: ReactElement<{ authority?: DataTableAuthority }>;
  workspaceId: string | undefined;
}) {
  const authority = useServerTableAuthority(authorityScope, workspaceId);
  return authority === undefined
    ? children
    : cloneElement(children, { authority });
}
