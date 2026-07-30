import type { ResourceGrant } from "@romeo/auth";

import { ApiError } from "../errors";

export interface ShareInput {
  principalType: ResourceGrant["principalType"];
  principalId: string;
  permissions: ResourceGrant["permission"][];
}

export interface ShareTarget {
  principalType: ShareInput["principalType"];
  principalId: string;
  label: string;
  detail?: string;
}

export function validateSharePrincipal(share: ShareInput): void {
  if (!["group", "service_account", "user"].includes(share.principalType)) {
    throw new ApiError(
      "invalid_principal",
      "Share principal type is not supported.",
      400,
    );
  }
  if (share.principalId.trim().length === 0)
    throw new ApiError(
      "invalid_principal",
      "Share principal ID is required.",
      400,
    );
  if (share.permissions.length === 0)
    throw new ApiError(
      "invalid_share_permission",
      "Share requires at least one permission.",
      400,
    );
}

export function targetMatches(target: ShareTarget, query: string): boolean {
  if (query.length === 0) return true;
  return (
    target.principalId.toLowerCase().includes(query) ||
    target.label.toLowerCase().includes(query) ||
    target.detail?.toLowerCase().includes(query) === true
  );
}

export function groupLabel(groupId: string): string {
  return (
    groupId
      .replace(/^group_/u, "")
      .split(/[_-]+/u)
      .filter((part) => part.length > 0)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ") || groupId
  );
}

export function principalOrder(type: ShareTarget["principalType"]): number {
  if (type === "user") return 0;
  if (type === "group") return 1;
  return 2;
}
