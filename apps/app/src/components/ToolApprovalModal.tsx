import Check from "lucide-react/dist/esm/icons/check.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { Button, Dialog } from "@romeo/ui";

import { useLocale } from "../lib/i18n";
import type { PendingToolApproval } from "./useToolExecution";

export function ToolApprovalModal({
  approval,
  isExecuting,
  onApprove,
  onCancel,
}: {
  approval: PendingToolApproval;
  isExecuting: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <Dialog
      className="max-w-sm"
      closeLabel={t("close")}
      footer={
        <>
          <Button onClick={onCancel}>
            <X aria-hidden="true" size={16} />
            <span>{t("toolApprovalCancel")}</span>
          </Button>
          <Button
            disabled={isExecuting}
            onClick={onApprove}
            pending={isExecuting}
            variant="primary"
          >
            <Check aria-hidden="true" size={16} />
            <span>
              {isExecuting
                ? t("toolApprovalApproving")
                : t("toolApprovalApprove")}
            </span>
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      open
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" size={18} />
          {approval.name}
        </span>
      }
    >
      <div className="grid gap-1 text-sm text-muted">
        <div>
          {t("toolApprovalRisk")}: {approval.riskLevel}
        </div>
        <div>
          {t("toolApprovalPolicy")}: {approval.approvalPolicy}
        </div>
        <div>
          {t("toolApprovalInputKeys")}:{" "}
          {approval.inputKeys.join(", ") || t("toolApprovalNone")}
        </div>
      </div>
    </Dialog>
  );
}
