import type { Group, GroupMembership, User } from "../domain/entities";

export const scimUserSchema = "urn:ietf:params:scim:schemas:core:2.0:User";
export const scimGroupSchema = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const scimListResponseSchema =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const scimPatchOpSchema =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const scimErrorSchema = "urn:ietf:params:scim:api:messages:2.0:Error";
export const scimEnterpriseUserSchema =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

export interface ScimListResponse<T> {
  schemas: [typeof scimListResponseSchema];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  userName: string;
  name: { formatted: string };
  displayName: string;
  active: boolean;
  emails: { value: string; primary: boolean; type: "work" }[];
  groups: { value: string; display?: string }[];
  meta: {
    resourceType: "User";
    location: string;
  };
}

export interface ScimGroupResource {
  schemas: [typeof scimGroupSchema];
  id: string;
  displayName: string;
  members: { value: string; display?: string }[];
  meta: {
    resourceType: "Group";
    created: string;
    location: string;
  };
}

export function scimListResponse<T>(
  resources: T[],
  input: { totalResults: number; startIndex: number },
): ScimListResponse<T> {
  return {
    schemas: [scimListResponseSchema],
    totalResults: input.totalResults,
    startIndex: input.startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function toScimUser(input: {
  user: User;
  groups: Group[];
  memberships: GroupMembership[];
  baseUrl: string;
}): ScimUserResource {
  const groupById = new Map(input.groups.map((group) => [group.id, group]));
  return {
    schemas: [scimUserSchema],
    id: input.user.id,
    userName: input.user.email,
    name: { formatted: input.user.name },
    displayName: input.user.name,
    active: input.user.disabledAt === undefined,
    emails: [{ value: input.user.email, primary: true, type: "work" }],
    groups: input.memberships
      .filter((membership) => membership.userId === input.user.id)
      .map((membership) => {
        const display = groupById.get(membership.groupId)?.name;
        return display === undefined
          ? { value: membership.groupId }
          : { value: membership.groupId, display };
      })
      .sort((left, right) => left.value.localeCompare(right.value)),
    meta: {
      resourceType: "User",
      location: `${input.baseUrl}/api/v1/scim/v2/Users/${encodeURIComponent(
        input.user.id,
      )}`,
    },
  };
}

export function toScimGroup(input: {
  group: Group;
  users: User[];
  memberships: GroupMembership[];
  baseUrl: string;
}): ScimGroupResource {
  const userById = new Map(input.users.map((user) => [user.id, user]));
  return {
    schemas: [scimGroupSchema],
    id: input.group.id,
    displayName: input.group.name,
    members: input.memberships
      .filter((membership) => membership.groupId === input.group.id)
      .map((membership) => {
        const display = userById.get(membership.userId)?.name;
        return display === undefined
          ? { value: membership.userId }
          : { value: membership.userId, display };
      })
      .sort((left, right) => left.value.localeCompare(right.value)),
    meta: {
      resourceType: "Group",
      created: input.group.createdAt,
      location: `${input.baseUrl}/api/v1/scim/v2/Groups/${encodeURIComponent(
        input.group.id,
      )}`,
    },
  };
}

export function scimServiceProviderConfig(baseUrl: string) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: `${baseUrl}/api/v1/docs`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Romeo bearer token",
        description:
          "Use a Romeo service-account API key or bearer credential with admin scopes.",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: `${baseUrl}/api/v1/scim/v2/ServiceProviderConfig`,
    },
  };
}

export function scimResourceTypes(baseUrl: string) {
  return scimListResponse(
    [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/Users",
        schema: scimUserSchema,
        meta: {
          resourceType: "ResourceType",
          location: `${baseUrl}/api/v1/scim/v2/ResourceTypes/User`,
        },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/Groups",
        schema: scimGroupSchema,
        meta: {
          resourceType: "ResourceType",
          location: `${baseUrl}/api/v1/scim/v2/ResourceTypes/Group`,
        },
      },
    ],
    { totalResults: 2, startIndex: 1 },
  );
}

export function scimSchemas(baseUrl: string) {
  return scimListResponse(
    [
      {
        id: scimUserSchema,
        name: "User",
        description: "Romeo SCIM user resource",
        attributes: [],
        meta: {
          resourceType: "Schema",
          location: `${baseUrl}/api/v1/scim/v2/Schemas/${encodeURIComponent(
            scimUserSchema,
          )}`,
        },
      },
      {
        id: scimGroupSchema,
        name: "Group",
        description: "Romeo SCIM group resource",
        attributes: [],
        meta: {
          resourceType: "Schema",
          location: `${baseUrl}/api/v1/scim/v2/Schemas/${encodeURIComponent(
            scimGroupSchema,
          )}`,
        },
      },
    ],
    { totalResults: 2, startIndex: 1 },
  );
}
