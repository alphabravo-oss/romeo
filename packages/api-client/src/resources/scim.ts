import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  ScimGroup,
  ScimListInput,
  ScimListResponse,
  ScimPatchOp,
  ScimUser,
} from "../types";

export function createScimResource(transport: RomeoTransport) {
  return {
    serviceProviderConfig: () =>
      transport.request<Record<string, unknown>>(
        "GET",
        "/api/v1/scim/v2/ServiceProviderConfig",
      ),
    schemas: () =>
      transport.request<ScimListResponse>("GET", "/api/v1/scim/v2/Schemas"),
    resourceTypes: () =>
      transport.request<ScimListResponse>(
        "GET",
        "/api/v1/scim/v2/ResourceTypes",
      ),
    users: (input: ScimListInput = {}) =>
      transport.request<ScimListResponse<ScimUser>>(
        "GET",
        withQuery("/api/v1/scim/v2/Users", {
          filter: input.filter,
          startIndex: input.startIndex,
          count: input.count,
        }),
      ),
    createUser: (input: ScimUser) =>
      transport.request<ScimUser>("POST", "/api/v1/scim/v2/Users", input),
    user: (userId: string) =>
      transport.request<ScimUser>(
        "GET",
        `/api/v1/scim/v2/Users/${pathId(userId)}`,
      ),
    replaceUser: (userId: string, input: ScimUser) =>
      transport.request<ScimUser>(
        "PUT",
        `/api/v1/scim/v2/Users/${pathId(userId)}`,
        input,
      ),
    patchUser: (userId: string, input: ScimPatchOp) =>
      transport.request<ScimUser>(
        "PATCH",
        `/api/v1/scim/v2/Users/${pathId(userId)}`,
        input,
      ),
    deleteUser: (userId: string) =>
      transport.empty("DELETE", `/api/v1/scim/v2/Users/${pathId(userId)}`),
    groups: (input: ScimListInput = {}) =>
      transport.request<ScimListResponse<ScimGroup>>(
        "GET",
        withQuery("/api/v1/scim/v2/Groups", {
          filter: input.filter,
          startIndex: input.startIndex,
          count: input.count,
        }),
      ),
    createGroup: (input: ScimGroup) =>
      transport.request<ScimGroup>("POST", "/api/v1/scim/v2/Groups", input),
    group: (groupId: string) =>
      transport.request<ScimGroup>(
        "GET",
        `/api/v1/scim/v2/Groups/${pathId(groupId)}`,
      ),
    replaceGroup: (groupId: string, input: ScimGroup) =>
      transport.request<ScimGroup>(
        "PUT",
        `/api/v1/scim/v2/Groups/${pathId(groupId)}`,
        input,
      ),
    patchGroup: (groupId: string, input: ScimPatchOp) =>
      transport.request<ScimGroup>(
        "PATCH",
        `/api/v1/scim/v2/Groups/${pathId(groupId)}`,
        input,
      ),
    deleteGroup: (groupId: string) =>
      transport.empty("DELETE", `/api/v1/scim/v2/Groups/${pathId(groupId)}`),
  };
}
