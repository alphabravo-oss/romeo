import {
  toolApprovalsApprove,
  toolApprovalsCancel,
  toolApprovalsReject,
  type ToolApprovalDecision,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

async function decide(
  action: "approve" | "cancel" | "reject",
  approvalRequestId: string,
): Promise<ToolApprovalDecision> {
  configureBrowserApiClients();
  const options = { path: { approvalRequestId }, throwOnError: true } as const;
  const response =
    action === "approve"
      ? await toolApprovalsApprove(options)
      : action === "cancel"
        ? await toolApprovalsCancel(options)
        : await toolApprovalsReject(options);
  return response.data.data;
}

export const approveToolApproval = (approvalRequestId: string) =>
  decide("approve", approvalRequestId);
export const cancelToolApproval = (approvalRequestId: string) =>
  decide("cancel", approvalRequestId);
export const rejectToolApproval = (approvalRequestId: string) =>
  decide("reject", approvalRequestId);
