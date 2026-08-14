import { Button, Input } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  confirmTotpEnrollmentMutationOptions,
  disableTotpFactorMutationOptions,
  generateRecoveryCodesMutationOptions,
  localAuthStatusQueryOptions,
  setLocalPasswordMutationOptions,
  startTotpEnrollmentMutationOptions,
} from "../features/auth";
import type { TotpEnrollment } from "@romeo/api-client/generated/sdk";
import { PanelState } from "../lib/panel-state";
import { LocalizedDate } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { downloadText } from "../lib/download";
import { writeTextToClipboard } from "../lib/clipboard";
import { Section } from "./console";
import { FormDialog } from "./FormDialog";
import { AccountMfaDialogs, type RecoveryStep } from "./AccountMfaDialogs";
import { isLockoutRisk, recoveryCodesRemaining } from "./mfa-recovery";

export function AccountSecurityPanel() {
  const { t } = useLocale();
  const statusQuery = useQuery(localAuthStatusQueryOptions());

  const [pwOpen, setPwOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  const [totpCode, setTotpCode] = useState("");
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>();
  const [recoveryTotpCode, setRecoveryTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  const [disableFactorId, setDisableFactorId] = useState<string>();
  const [disableCode, setDisableCode] = useState("");

  const passwordMutation = useMutation(setLocalPasswordMutationOptions());
  const enrollMutation = useMutation(startTotpEnrollmentMutationOptions());
  const confirmMutation = useMutation(confirmTotpEnrollmentMutationOptions());
  const recoveryMutation = useMutation(generateRecoveryCodesMutationOptions());
  const disableMutation = useMutation(disableTotpFactorMutationOptions());

  const passwordForm = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      if (value.newPassword !== value.confirmPassword) {
        toast(t("passwordsDoNotMatch"), "error");
        return;
      }
      try {
        await passwordMutation.mutateAsync({
          newPassword: value.newPassword,
          ...(hasPassword ? { currentPassword: value.currentPassword } : {}),
        });
        toast(hasPassword ? t("passwordChanged") : t("passwordSet"), "success");
        passwordForm.reset();
        setPwOpen(false);
      } catch {
        toast(t("passwordUpdateFailed"), "error");
      }
    },
  });

  async function handleStartEnrollment() {
    try {
      const result = await enrollMutation.mutateAsync({});
      setEnrollment(result);
      setTotpCode("");
    } catch {
      toast(t("enrollmentStartFailed"), "error");
    }
  }

  async function handleConfirmEnrollment() {
    if (enrollment === undefined || !/^\d{6}$/u.test(totpCode)) return;
    try {
      await confirmMutation.mutateAsync({
        factorId: enrollment.factor.id,
        code: totpCode,
      });
      toast(t("authenticatorEnabled"), "success");
      setTotpCode("");
      // Confirmation activates MFA, but enrollment is not complete until the
      // user has generated and explicitly acknowledged their recovery codes.
      setRecoveryStep("awaiting-code");
    } catch {
      toast(t("verifyFailed"), "error");
    }
  }

  async function handleGenerateRecoveryCodes() {
    if (!/^\d{6}$/u.test(recoveryTotpCode)) return;
    try {
      const result = await recoveryMutation.mutateAsync({
        totpCode: recoveryTotpCode,
      });
      setRecoveryCodes(result.codes);
      setRecoveryTotpCode("");
      setRecoveryStep("showing-codes");
    } catch {
      toast(t("recoveryCodesFailed"), "error");
    }
  }

  async function handleCopyRecoveryCodes() {
    if (recoveryCodes.length === 0) return;
    if (await writeTextToClipboard(recoveryCodes.join("\n"))) {
      toast(t("copied"), "success");
    } else {
      toast(t("recoveryCodesCopyFailed"), "error");
    }
  }

  function handleDownloadRecoveryCodes() {
    if (recoveryCodes.length === 0) return;
    downloadText(`${recoveryCodes.join("\n")}\n`, "romeo-recovery-codes.txt");
  }

  function handleRecoveryCodesSaved() {
    setEnrollment(undefined);
    setRecoveryStep(undefined);
    setRecoveryTotpCode("");
    setRecoveryCodes([]);
  }

  function handleRegenerateRecoveryCodes() {
    setEnrollment(undefined);
    setRecoveryTotpCode("");
    setRecoveryCodes([]);
    setRecoveryStep("awaiting-code");
  }

  async function handleDisableFactor() {
    if (disableFactorId === undefined || !/^\d{6}$/u.test(disableCode)) return;
    try {
      await disableMutation.mutateAsync({
        factorId: disableFactorId,
        code: disableCode,
      });
      toast(t("authenticatorRemoved"), "success");
      setDisableFactorId(undefined);
      setDisableCode("");
    } catch {
      toast(t("removeAuthenticatorFailed"), "error");
    }
  }

  // Read once for the render + the password-form branch above (safe: query drives it).
  const hasPassword = statusQuery.data?.hasPassword ?? false;

  return (
    <Section>
      <div className="rm-card-title">{t("security")}</div>
      <PanelState query={statusQuery} isEmpty={() => false} empty="">
        {(status) => (
          <div className="grid gap-5">
            {/* Password */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {t("localPassword")}
                  </div>
                  <div className="text-xs text-muted">
                    {status.hasPassword
                      ? t("passwordIsSet")
                      : t("noPasswordSso")}
                  </div>
                </div>
                <Button onClick={() => setPwOpen(true)} type="button">
                  {status.hasPassword ? t("changePassword") : t("setPassword")}
                </Button>
              </div>
            </div>

            {/* MFA */}
            <div className="grid gap-2 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{t("twoFactor")}</div>
                  <div className="text-xs text-muted">
                    {status.mfaEnabled
                      ? t("authenticatorProtecting")
                      : t("addAuthenticatorDescription")}
                  </div>
                </div>
                <Button
                  variant="primary"
                  disabled={enrollMutation.isPending}
                  onClick={() => void handleStartEnrollment()}
                  type="button"
                >
                  {enrollMutation.isPending
                    ? t("starting")
                    : t("addAuthenticator")}
                </Button>
              </div>
              <div className="grid gap-2">
                {status.factors
                  .filter(
                    (factor) =>
                      factor.type === "totp" && factor.disabledAt === undefined,
                  )
                  .map((factor) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                      key={factor.id}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {factor.name || t("authenticatorApp")}
                        </div>
                        <div className="text-xs text-muted">
                          {factor.status}
                          {factor.lastUsedAt !== undefined ? (
                            <>
                              {" "}
                              · {t("lastUsed")}{" "}
                              <LocalizedDate value={factor.lastUsedAt} />
                            </>
                          ) : (
                            ""
                          )}
                        </div>
                      </div>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setDisableFactorId(factor.id);
                          setDisableCode("");
                        }}
                        type="button"
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  ))}
              </div>
              {status.mfaEnabled ? (
                <div className="grid gap-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">
                        {t("recoveryCodes")}
                      </div>
                      <div className="text-xs text-muted">
                        {t("recoveryCodesRemaining")}:{" "}
                        {recoveryCodesRemaining(status)}
                      </div>
                    </div>
                    <Button
                      disabled={recoveryStep !== undefined}
                      onClick={handleRegenerateRecoveryCodes}
                      type="button"
                    >
                      {t("recoveryCodesRegenerate")}
                    </Button>
                  </div>
                  {isLockoutRisk(status) ? (
                    <div className="rm-composer-error" role="status">
                      {t("recoveryCodesNone")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </PanelState>

      {/* Password dialog */}
      <FormDialog
        open={pwOpen}
        title={hasPassword ? t("changePassword") : t("setPassword")}
        description={t("useAtLeast12")}
        onClose={() => {
          passwordForm.reset();
          setPwOpen(false);
        }}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void passwordForm.handleSubmit();
          }}
        >
          {hasPassword ? (
            <passwordForm.Field
              name="currentPassword"
              validators={{
                onChange: ({ value }: { value: string }) =>
                  !value ? t("currentPasswordRequired") : undefined,
              }}
            >
              {(field) => (
                <label className="grid gap-1 text-sm">
                  <span className="text-muted">{t("currentPassword")}</span>
                  <Input
                    name="currentPassword"
                    autoComplete="current-password"
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(event.currentTarget.value)
                    }
                    type="password"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length ? (
                    <div className="rm-composer-error">
                      {field.state.meta.errors.join(", ")}
                    </div>
                  ) : null}
                </label>
              )}
            </passwordForm.Field>
          ) : null}
          <passwordForm.Field
            name="newPassword"
            validators={{
              onChange: ({ value }: { value: string }) =>
                value.length < 12 ? t("atLeast12") : undefined,
            }}
          >
            {(field) => (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">{t("newPassword")}</span>
                <Input
                  name="newPassword"
                  autoComplete="new-password"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="password"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </label>
            )}
          </passwordForm.Field>
          <passwordForm.Field name="confirmPassword">
            {(field) => (
              <label className="grid gap-1 text-sm">
                <span className="text-muted">{t("confirmNewPassword")}</span>
                <Input
                  name="confirmPassword"
                  autoComplete="new-password"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  type="password"
                  value={field.state.value}
                />
              </label>
            )}
          </passwordForm.Field>
          <passwordForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                variant="primary"
                disabled={
                  !canSubmit || isSubmitting || passwordMutation.isPending
                }
                type="submit"
              >
                {passwordMutation.isPending ? t("saving") : t("savePassword")}
              </Button>
            )}
          </passwordForm.Subscribe>
        </form>
      </FormDialog>

      <AccountMfaDialogs
        disableCode={disableCode}
        disableFactorId={disableFactorId}
        enrollment={enrollment}
        isConfirming={confirmMutation.isPending}
        isDisabling={disableMutation.isPending}
        isGeneratingRecoveryCodes={recoveryMutation.isPending}
        onCloseDisable={() => {
          if (disableMutation.isPending) return;
          setDisableFactorId(undefined);
          setDisableCode("");
        }}
        onCloseEnrollment={() => {
          // Once MFA is active, closing before recovery codes are saved would
          // recreate the lockout this flow exists to prevent.
          if (recoveryStep !== undefined) return;
          setEnrollment(undefined);
          setTotpCode("");
        }}
        onConfirmEnrollment={handleConfirmEnrollment}
        onCopyRecoveryCodes={handleCopyRecoveryCodes}
        onDisableCodeChange={setDisableCode}
        onDisableFactor={handleDisableFactor}
        onGenerateRecoveryCodes={handleGenerateRecoveryCodes}
        onRecoveryCodesSaved={handleRecoveryCodesSaved}
        onRecoveryTotpCodeChange={setRecoveryTotpCode}
        onTotpCodeChange={setTotpCode}
        recoveryCodes={recoveryCodes}
        onDownloadRecoveryCodes={handleDownloadRecoveryCodes}
        recoveryStep={recoveryStep}
        recoveryTotpCode={recoveryTotpCode}
        totpCode={totpCode}
      />
    </Section>
  );
}
