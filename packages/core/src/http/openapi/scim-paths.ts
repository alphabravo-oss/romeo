const scimJson = (schema: object) => ({
  "application/scim+json": { schema },
});

const scimError = {
  description: "SCIM error response",
  content: scimJson({ $ref: "#/components/schemas/ScimError" }),
};

const listParameters = [
  {
    name: "filter",
    in: "query",
    required: false,
    schema: { type: "string" },
  },
  {
    name: "startIndex",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1 },
  },
  {
    name: "count",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: 200 },
  },
];

const userPathParameter = {
  name: "userId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const groupPathParameter = {
  name: "groupId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

export const scimPaths = {
  "/scim/v2/ServiceProviderConfig": {
    get: {
      summary: "Get SCIM service provider configuration",
      responses: {
        200: {
          description: "SCIM service provider configuration",
          content: scimJson({ type: "object", additionalProperties: true }),
        },
        403: scimError,
        404: scimError,
      },
    },
  },
  "/scim/v2/Schemas": {
    get: {
      summary: "List SCIM schemas",
      responses: {
        200: {
          description: "SCIM schema list",
          content: scimJson({ $ref: "#/components/schemas/ScimListResponse" }),
        },
        403: scimError,
        404: scimError,
      },
    },
  },
  "/scim/v2/ResourceTypes": {
    get: {
      summary: "List SCIM resource types",
      responses: {
        200: {
          description: "SCIM resource type list",
          content: scimJson({ $ref: "#/components/schemas/ScimListResponse" }),
        },
        403: scimError,
        404: scimError,
      },
    },
  },
  "/scim/v2/Users": {
    get: {
      summary: "List SCIM users",
      parameters: listParameters,
      responses: {
        200: {
          description: "SCIM user list",
          content: scimJson({ $ref: "#/components/schemas/ScimListResponse" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
      },
    },
    post: {
      summary: "Create a SCIM user",
      requestBody: {
        required: true,
        content: scimJson({ $ref: "#/components/schemas/ScimUser" }),
      },
      responses: {
        201: {
          description: "SCIM user",
          content: scimJson({ $ref: "#/components/schemas/ScimUser" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
        409: scimError,
      },
    },
  },
  "/scim/v2/Users/{userId}": {
    get: {
      summary: "Get a SCIM user",
      parameters: [userPathParameter],
      responses: {
        200: {
          description: "SCIM user",
          content: scimJson({ $ref: "#/components/schemas/ScimUser" }),
        },
        403: scimError,
        404: scimError,
      },
    },
    put: {
      summary: "Replace a SCIM user",
      parameters: [userPathParameter],
      requestBody: {
        required: true,
        content: scimJson({ $ref: "#/components/schemas/ScimUser" }),
      },
      responses: {
        200: {
          description: "SCIM user",
          content: scimJson({ $ref: "#/components/schemas/ScimUser" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
        409: scimError,
      },
    },
    patch: {
      summary: "Patch a SCIM user",
      parameters: [userPathParameter],
      requestBody: {
        required: true,
        content: scimJson({ $ref: "#/components/schemas/ScimPatchOp" }),
      },
      responses: {
        200: {
          description: "SCIM user",
          content: scimJson({ $ref: "#/components/schemas/ScimUser" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
        409: scimError,
      },
    },
    delete: {
      summary: "Deactivate a SCIM user",
      parameters: [userPathParameter],
      responses: {
        204: { description: "SCIM user deactivated" },
        403: scimError,
        404: scimError,
      },
    },
  },
  "/scim/v2/Groups": {
    get: {
      summary: "List SCIM groups",
      parameters: listParameters,
      responses: {
        200: {
          description: "SCIM group list",
          content: scimJson({ $ref: "#/components/schemas/ScimListResponse" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
      },
    },
    post: {
      summary: "Create a SCIM group",
      requestBody: {
        required: true,
        content: scimJson({ $ref: "#/components/schemas/ScimGroup" }),
      },
      responses: {
        201: {
          description: "SCIM group",
          content: scimJson({ $ref: "#/components/schemas/ScimGroup" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
      },
    },
  },
  "/scim/v2/Groups/{groupId}": {
    get: {
      summary: "Get a SCIM group",
      parameters: [groupPathParameter],
      responses: {
        200: {
          description: "SCIM group",
          content: scimJson({ $ref: "#/components/schemas/ScimGroup" }),
        },
        403: scimError,
        404: scimError,
      },
    },
    put: {
      summary: "Replace a SCIM group",
      parameters: [groupPathParameter],
      requestBody: {
        required: true,
        content: scimJson({ $ref: "#/components/schemas/ScimGroup" }),
      },
      responses: {
        200: {
          description: "SCIM group",
          content: scimJson({ $ref: "#/components/schemas/ScimGroup" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
      },
    },
    patch: {
      summary: "Patch a SCIM group",
      parameters: [groupPathParameter],
      requestBody: {
        required: true,
        content: scimJson({ $ref: "#/components/schemas/ScimPatchOp" }),
      },
      responses: {
        200: {
          description: "SCIM group",
          content: scimJson({ $ref: "#/components/schemas/ScimGroup" }),
        },
        400: scimError,
        403: scimError,
        404: scimError,
      },
    },
    delete: {
      summary: "Delete a SCIM group and revoke group grants",
      parameters: [groupPathParameter],
      responses: {
        204: { description: "SCIM group deleted" },
        403: scimError,
        404: scimError,
      },
    },
  },
};
