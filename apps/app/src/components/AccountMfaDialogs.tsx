import { Button, Field, Input } from "@romeo/ui";
import type { TotpEnrollment } from "@romeo/api-client/generated/sdk";

import { useLocale } from "../lib/i18n";
import { FormDialog } from "./FormDialog";

export type RecoveryStep = "awaiting-code" | "showing-codes";

export function AccountMfaDialogs({
  disableCode,
  disableFactorId,
  enrollment,
  isConfirming,
  isDisabling,
  isGeneratingRecoveryCodes,
  onCloseDisable,
  onCloseEnrollment,
  onConfirmEnrollment,
  onCopyRecoveryCodes,
  onDisableCodeChange,
  onDisableFactor,
  onDownloadRecoveryCodes,
  onGenerateRecoveryCodes,
  onRecoveryCodesSaved,
  onRecoveryTotpCodeChange,
  onTotpCodeChange,
  recoveryCodes,
  recoveryStep,
  recoveryTotpCode,
  totpCode,
}: {
  disableCode: string;
  disableFactorId: string | undefined;
  enrollment: TotpEnrollment | undefined;
  isConfirming: boolean;
  isDisabling: boolean;
  isGeneratingRecoveryCodes: boolean;
  onCloseDisable: () => void;
  onCloseEnrollment: () => void;
  onConfirmEnrollment: () => Promise<void>;
  onCopyRecoveryCodes: () => Promise<void>;
  onDisableCodeChange: (code: string) => void;
  onDisableFactor: () => Promise<void>;
  onDownloadRecoveryCodes: () => void;
  onGenerateRecoveryCodes: () => Promise<void>;
  onRecoveryCodesSaved: () => void;
  onRecoveryTotpCodeChange: (code: string) => void;
  onTotpCodeChange: (code: string) => void;
  recoveryCodes: readonly string[];
  recoveryStep: RecoveryStep | undefined;
  recoveryTotpCode: string;
  totpCode: string;
}) {
  const { t } = useLocale();

  return (
    <>
      <FormDialog
        open={enrollment !== undefined || recoveryStep !== undefined}
        title={
          recoveryStep === undefined
            ? t("setupAuthenticator")
            : t("recoveryCodes")
        }
        description={
          recoveryStep === undefined
            ? t("scanAuthenticator")
            : t("recoveryCodesWhy")
        }
        onClose={onCloseEnrollment}
      >
        {recoveryStep === "awaiting-code" ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onGenerateRecoveryCodes();
            }}
          >
            <p className="text-sm text-muted">{t("recoveryCodesWhy")}</p>
            <Field label={t("verificationCode")}>
              <Input
                name="recoveryTotpCode"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  onRecoveryTotpCodeChange(
                    event.currentTarget.value.replace(/\D/gu, ""),
                  )
                }
                placeholder="000000"
                value={recoveryTotpCode}
              />
            </Field>
            <Button
              variant="primary"
              disabled={
                !/^\d{6}$/u.test(recoveryTotpCode) || isGeneratingRecoveryCodes
              }
              pending={isGeneratingRecoveryCodes}
              type="submit"
            >
              {t("recoveryCodesGenerate")}
            </Button>
          </form>
        ) : recoveryStep === "showing-codes" ? (
          <div className="grid gap-3">
            <div className="rm-composer-error" role="status">
              {t("recoveryCodesShownOnce")}
            </div>
            <ul className="grid gap-1 rounded-md border border-border p-3">
              {recoveryCodes.map((code) => (
                <li className="font-mono text-sm" key={code}>
                  {code}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onCopyRecoveryCodes()} type="button">
                {t("recoveryCodesCopyAll")}
              </Button>
              <Button onClick={onDownloadRecoveryCodes} type="button">
                {t("recoveryCodesDownload")}
              </Button>
            </div>
            <Button
              variant="primary"
              onClick={onRecoveryCodesSaved}
              type="button"
            >
              {t("recoveryCodesSaved")}
            </Button>
          </div>
        ) : enrollment !== undefined ? (
          <div className="grid gap-3">
            <div className="grid gap-1 text-sm">
              <span className="text-muted">{t("setupKey")}</span>
              <code className="break-all font-mono text-sm">
                {enrollment.secret}
              </code>
              <span className="text-xs text-muted">{t("manualSetupKey")}</span>
            </div>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">{t("otpUri")}</summary>
              <code className="mt-1 block break-all font-mono">
                {enrollment.otpauthUri}
              </code>
            </details>
            <label className="grid gap-1 text-sm">
              <span className="text-muted">{t("sixDigitCode")}</span>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  onTotpCodeChange(
                    event.currentTarget.value.replace(/\D/gu, ""),
                  )
                }
                placeholder="000000"
                value={totpCode}
              />
            </label>
            <Button
              variant="primary"
              disabled={!/^\d{6}$/u.test(totpCode) || isConfirming}
              onClick={() => void onConfirmEnrollment()}
              type="button"
            >
              {isConfirming ? t("verifying") : t("verifyEnable")}
            </Button>
          </div>
        ) : null}
      </FormDialog>

      <FormDialog
        open={disableFactorId !== undefined}
        title={t("removeAuthenticatorTitle")}
        description={t("removeAuthenticatorBody")}
        onClose={onCloseDisable}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onDisableFactor();
          }}
        >
          <Field
            description={t("removeAuthenticatorCodeRequired")}
            label={t("verificationCode")}
          >
            <Input
              name="disableAuthenticatorCode"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                onDisableCodeChange(
                  event.currentTarget.value.replace(/\D/gu, ""),
                )
              }
              placeholder="000000"
              value={disableCode}
            />
          </Field>
          <Button
            variant="danger"
            disabled={!/^\d{6}$/u.test(disableCode) || isDisabling}
            pending={isDisabling}
            type="submit"
          >
            {t("remove")}
          </Button>
        </form>
      </FormDialog>
    </>
  );
}
