import { Button, Checkbox, NativeSelect } from "@romeo/ui";

import type { Chat } from "../features/types";
import { useLocale } from "../lib/i18n";
import { FormDialog } from "./FormDialog";

export interface ShareDialogProps {
  canWrite: boolean;
  chat: Chat | null;
  isPending: boolean;
  onCanWriteChange: (value: boolean) => void;
  onClose: () => void;
  onRevoke: (grantId: string) => void;
  onSubmit: (targetKey: string) => void;
  onTargetKeyChange: (value: string) => void;
  revokeError: boolean;
  revokePending: boolean;
  shareError: boolean;
  shares: Array<{ id: string; permission: string; principalId: string }>;
  sharesLoaded: boolean;
  targetKey: string;
  targets: Array<{
    label: string;
    principalId: string;
    principalType: "group" | "service_account" | "user";
  }>;
  targetsLoaded: boolean;
}

export function ShareDialog(props: ShareDialogProps) {
  const { t } = useLocale();
  return (
    <FormDialog
      onClose={props.onClose}
      open={props.chat !== null}
      title={t("shareChat")}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.targetKey.length > 0) props.onSubmit(props.targetKey);
        }}
      >
        <label className="grid gap-1 text-sm" htmlFor="share-chat-target">
          <span className="text-muted">{t("personOrGroup")}</span>
          <NativeSelect
            name="share-chat-target"
            id="share-chat-target"
            onChange={(event) =>
              props.onTargetKeyChange(event.currentTarget.value)
            }
            required
            value={props.targetKey}
          >
            <option value="">{t("selectShareTarget")}</option>
            {props.targets.map((target) => (
              <option
                key={`${target.principalType}:${target.principalId}`}
                value={`${target.principalType}:${target.principalId}`}
              >
                {target.label} · {target.principalType}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Checkbox
          checked={props.canWrite}
          label={t("allowEdits")}
          onCheckedChange={(checked) =>
            props.onCanWriteChange(checked === true)
          }
        />
        {props.targetsLoaded && props.targets.length === 0 ? (
          <p className="text-sm text-muted">{t("noEligibleShares")}</p>
        ) : null}
        {props.shareError ? (
          <p className="text-sm text-danger">{t("shareFailed")}</p>
        ) : null}
        <Button
          variant="primary"
          disabled={props.targetKey.length === 0 || props.isPending}
          type="submit"
        >
          {props.isPending ? t("sharing") : t("share")}
        </Button>
        <div className="grid gap-2 border-t border-border pt-3">
          <strong className="text-sm">{t("currentAccess")}</strong>
          {props.shares.map((grant) => (
            <div className="rm-list-row" key={grant.id}>
              <span className="min-w-0 flex-1 truncate text-sm">
                {grant.principalId} · {grant.permission}
              </span>
              <Button
                variant="danger"
                disabled={props.revokePending}
                onClick={() => props.onRevoke(grant.id)}
                type="button"
              >
                {t("revoke")}
              </Button>
            </div>
          ))}
          {props.sharesLoaded && props.shares.length === 0 ? (
            <p className="text-sm text-muted">{t("noAccessGrants")}</p>
          ) : null}
          {props.revokeError ? (
            <p className="text-sm text-danger">{t("revokeFailed")}</p>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}
