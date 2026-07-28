import type { RagPolicyChangeRequest } from "../domain/rag-policy";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { parseStoredPolicy } from "./rag-policy-normalization";
import { parseStoredChangeRequest } from "./rag-policy-change-reporting";
import type { StoredRagPolicy } from "./rag-policy-types";

const settingKeyPrefix = "rag_policy.org.v1:";
const changeRequestSettingKeyPrefix = "rag_policy.change_request.org.v1:";

export function settingKey(orgId: string): string {
  return `${settingKeyPrefix}${orgId}`;
}

export function changeRequestSettingKey(orgId: string): string {
  return `${changeRequestSettingKeyPrefix}${orgId}`;
}

export async function readStoredRagPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredRagPolicy | undefined> {
  const setting = await repository.getSystemSetting(settingKey(orgId));
  if (setting === undefined) return undefined;
  return parseStoredPolicy(setting.value, orgId);
}

export async function readStoredRagPolicyChangeRequest(
  repository: RomeoRepository,
  orgId: string,
): Promise<RagPolicyChangeRequest | null> {
  const setting = await repository.getSystemSetting(
    changeRequestSettingKey(orgId),
  );
  if (setting === undefined) return null;
  return parseStoredChangeRequest(setting.value, orgId);
}

export async function requiredPendingChangeRequest(
  repository: RomeoRepository,
  orgId: string,
  requestId: string,
): Promise<RagPolicyChangeRequest> {
  const request = await readStoredRagPolicyChangeRequest(repository, orgId);
  if (request === null || request.requestId !== requestId) {
    throw new ApiError(
      "rag_policy_change_request_not_found",
      "RAG policy change request was not found.",
      404,
    );
  }
  if (request.status !== "pending") {
    throw new ApiError(
      "rag_policy_change_request_not_pending",
      "RAG policy change request is no longer pending.",
      409,
      { requestId },
    );
  }
  return request;
}
