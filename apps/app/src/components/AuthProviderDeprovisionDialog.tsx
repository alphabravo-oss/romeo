import { Button, Input } from "@romeo/ui";
import React, { useState } from "react";

import type { AuthProviderCatalogEntry } from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import { FormDialog } from "./FormDialog";

export function DeprovisionDialog(props: {
  entry: AuthProviderCatalogEntry;
  busy: boolean;
  onClose: () => void;
  onSubmit: (oidcSubject: string) => void;
}): React.ReactNode {
  const { t } = useLocale();
  const { entry, busy, onClose, onSubmit } = props;
  const [oidcSubject, setOidcSubject] = useState("");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    event.stopPropagation();
    onSubmit(oidcSubject);
  }

  return (
    <FormDialog
      open
      title={`${t("authDeprovisionOidcUser")} — ${entry.name}`}
      description={t("authDeprovisionDescription")}
      onClose={onClose}
    >
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <label className="text-sm text-muted" htmlFor="ap-deprovision-subject">
          {t("authOidcSubject")}
        </label>
        <Input
          name="ap-deprovision-subject"
          id="ap-deprovision-subject"
          onChange={(event) => setOidcSubject(event.currentTarget.value)}
          placeholder={t("authSubjectClaimPlaceholder")}
          value={oidcSubject}
        />
        <span className="text-xs text-muted">
          {t("authActiveIssuerGuidance")}
        </span>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button">
            {t("authCancel")}
          </Button>
          <Button
            className="danger"
            variant="primary"
            disabled={busy || oidcSubject.trim().length === 0}
            type="submit"
          >
            {busy ? t("authDeprovisioning") : t("authContinue")}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

/**
 * "Configure {name}" form. Prefills what the summary exposes (displayName,
 * loginOrder, allowedEmailDomains, groupClaim). Raw issuer/clientId are never
 * returned by the API, so those stay blank with a "leave blank to keep" hint;
 * we omit empty ones from the patch so they aren't cleared.
 *
 * v1 intentionally omits the groupMap / workspaceGroupMap key-value editors —
 * add a dedicated mapping editor later.
 */
