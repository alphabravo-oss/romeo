export interface ScimListResponse<T = Record<string, unknown>> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimUser {
  schemas?: string[];
  id?: string;
  externalId?: string;
  userName?: string;
  name?: {
    formatted?: string;
    givenName?: string;
    familyName?: string;
    [key: string]: unknown;
  };
  displayName?: string;
  active?: boolean;
  emails?: Array<{
    value?: string;
    primary?: boolean;
    type?: string;
    [key: string]: unknown;
  }>;
  groups?: Array<{ value: string; display?: string }>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ScimGroup {
  schemas?: string[];
  id?: string;
  externalId?: string;
  displayName?: string;
  members?: Array<{ value?: string; display?: string; [key: string]: unknown }>;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ScimPatchOp {
  schemas?: string[];
  Operations: Array<{
    op: "add" | "replace" | "remove" | string;
    path?: string;
    value?: unknown;
    [key: string]: unknown;
  }>;
}

export interface ScimListInput {
  filter?: string;
  startIndex?: number;
  count?: number;
}
