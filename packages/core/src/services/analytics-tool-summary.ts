import type { ToolCallRecord } from "../domain/entities";
import type { AdminAnalyticsToolSummary } from "./analytics-service";

export function emptyToolSummary(): Omit<AdminAnalyticsToolSummary, "byTool"> {
  return {
    approvalRequiredCount: 0,
    blockedCount: 0,
    failureCount: 0,
    pendingApprovalCount: 0,
    successCount: 0,
    totalCount: 0,
  };
}

export function countToolCall(
  target: Omit<AdminAnalyticsToolSummary, "byTool">,
  call: ToolCallRecord,
): void {
  target.totalCount += 1;
  if (call.approvalRequired) target.approvalRequiredCount += 1;
  if (call.status === "approval_required") target.pendingApprovalCount += 1;
  if (call.status === "blocked") target.blockedCount += 1;
  if (call.status === "failure") target.failureCount += 1;
  if (call.status === "success") target.successCount += 1;
}
