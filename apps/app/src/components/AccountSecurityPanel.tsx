import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  confirmTotpEnrollment,
  disableTotpFactor,
  getLocalAuthStatus,
  setLocalPassword,
  startTotpEnrollment,
} from "../features/auth";
import type { TotpEnrollment } from "@romeo/api-client/generated/sdk";
import { PanelState } from "../lib/panel-state";
import { LocalizedDate } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";

export function AccountSecurityPanel() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const statusQuery = useQuery({
    queryKey: ["localAuthStatus"],
    queryFn: getLocalAuthStatus,
  });

  const [pwOpen, setPwOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  const [totpCode, setTotpCode] = useState("");

  const passwordMutation = useMutation({ mutationFn: setLocalPassword });
  const enrollMutation = useMutation({ mutationFn: startTotpEnrollment });
  const confirmMutation = useMutation({ mutationFn: confirmTotpEnrollment });
  const disableMutation = useMutation({ mutationFn: disableTotpFactor });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["localAuthStatus"] });

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
        await refresh();
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
      await refresh();
      toast(t("authenticatorEnabled"), "success");
      setEnrollment(undefined);
      setTotpCode("");
    } catch {
      toast(t("verifyFailed"), "error");
    }
  }

  async function handleDisableFactor(factorId: string) {
    if (
      !(await ask({
        title: t("removeAuthenticatorTitle"),
        body: t("removeAuthenticatorBody"),
        confirmLabel: t("remove"),
        tone: "danger",
      }))
    )
      return;
    try {
      await disableMutation.mutateAsync({ factorId });
      await refresh();
      toast(t("authenticatorRemoved"), "success");
    } catch {
      toast(t("removeAuthenticatorFailed"), "error");
    }
  }

  // Read once for the render + the password-form branch above (safe: query drives it).
  const hasPassword = statusQuery.data?.hasPassword ?? false;

  return (
    <section className="rm-panel p-4">
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
                  .filter((factor) => factor.disabledAt === undefined)
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
                        onClick={() => void handleDisableFactor(factor.id)}
                        type="button"
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  ))}
              </div>
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

      {/* TOTP enrollment dialog */}
      <FormDialog
        open={enrollment !== undefined}
        title={t("setupAuthenticator")}
        description={t("scanAuthenticator")}
        onClose={() => {
          setEnrollment(undefined);
          setTotpCode("");
        }}
      >
        {enrollment !== undefined ? (
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
                  setTotpCode(event.currentTarget.value.replace(/\D/gu, ""))
                }
                placeholder="000000"
                value={totpCode}
              />
            </label>
            <Button
              variant="primary"
              disabled={!/^\d{6}$/u.test(totpCode) || confirmMutation.isPending}
              onClick={() => void handleConfirmEnrollment()}
              type="button"
            >
              {confirmMutation.isPending ? t("verifying") : t("verifyEnable")}
            </Button>
          </div>
        ) : null}
      </FormDialog>

      {dialog}
    </section>
  );
}
