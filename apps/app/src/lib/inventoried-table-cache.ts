import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "./app-query-keys";
import type {
  InventoriedTableResourceName,
  InventoriedTableResourceRegistry,
} from "./inventoried-table-resource-registry";

type InventoriedInvalidationInput<
  Resource extends InventoriedTableResourceName,
> = {
  resource: Resource;
} & (InventoriedTableResourceRegistry[Resource]["scope"] extends "parent"
  ? { parentId: string; workspaceId?: never }
  : InventoriedTableResourceRegistry[Resource]["scope"] extends "workspace"
    ? { parentId?: never; workspaceId: string }
    : { parentId?: never; workspaceId?: never });

export async function invalidateInventoriedTablePages<
  Resource extends InventoriedTableResourceName,
>(
  client: QueryClient,
  input: InventoriedInvalidationInput<Resource>,
): Promise<void> {
  await Promise.all(
    client
      .getQueryCache()
      .findAll({ queryKey: appQueryKeys.tablePages() })
      .filter((query) => {
        const request = query.queryKey[1];
        if (typeof request !== "object" || request === null) return false;
        if (!("resource" in request) || request.resource !== input.resource)
          return false;
        if (
          input.parentId !== undefined &&
          (!("parentId" in request) || request.parentId !== input.parentId)
        )
          return false;
        return !(
          input.workspaceId !== undefined &&
          (!("workspaceId" in request) ||
            request.workspaceId !== input.workspaceId)
        );
      })
      .map((query) =>
        client.invalidateQueries({ exact: true, queryKey: query.queryKey }),
      ),
  );
}
