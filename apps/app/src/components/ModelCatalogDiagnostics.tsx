import { Button, Checkbox, StatusBadge } from "@romeo/ui";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import type { BaseModel, Provider } from "../features/providers/types";
import {
  previewModelCompatibility,
  probeModelCapabilities,
} from "../features/providers/mutations";
import { catalogUnavailableReason } from "../lib/catalog-model-surface";
import { useLocale, type MessageKey } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { toast } from "../lib/toast";

const defaultRequired = {
  attachments: false,
  imageOutput: false,
  localOnly: false,
  reasoning: false,
  tools: false,
};

export function ModelCatalogDiagnostics({
  model,
  provider,
}: {
  model: BaseModel;
  provider: Provider | undefined;
}) {
  const { t } = useLocale();
  const probeAbort = useRef<AbortController | undefined>(undefined);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string>();
  const [probeSummary, setProbeSummary] = useState<string>();
  const [required, setRequired] = useState(defaultRequired);
  const [constraint, setConstraint] = useState<string>();
  const syncReason = catalogUnavailableReason(model);

  async function runProbe() {
    probeAbort.current?.abort();
    const controller = new AbortController();
    probeAbort.current = controller;
    setProbing(true);
    setProbeError(undefined);
    try {
      const result = await probeModelCapabilities({
        features: ["streaming", "tools", "json", "vision", "audio", "reasoning"],
        modelId: model.id,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const mismatches = result.results.filter(
        (item) => item.outcome === "mismatch",
      ).length;
      setProbeSummary(
        t("catalogProbeComplete", {
          mismatches,
          total: result.results.length,
        }),
      );
      toast(t("catalogProbeComplete", { mismatches, total: result.results.length }), "success");
    } catch (caught) {
      if (controller.signal.aborted) {
        toast(t("catalogProbeCancelled"));
        return;
      }
      const message = safeUserErrorMessage(caught, t("catalogProbeFailed"));
      setProbeError(message);
      toast(message, "error");
    } finally {
      if (probeAbort.current === controller) setProbing(false);
    }
  }

  async function preview() {
    try {
      const result = await previewModelCompatibility({
        modelId: model.id,
        required,
      });
      setConstraint(
        result.outcome === "available"
          ? t("catalogCompatibilityAvailable")
          : t(constraintKey(result.constraint)),
      );
    } catch (caught) {
      toast(safeUserErrorMessage(caught, t("catalogCompatibilityFailed")), "error");
    }
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div>
        <strong>{t("catalogDiagnostics")}</strong>
        <p className="text-xs text-muted">{t("catalogDiagnosticsHelp")}</p>
      </div>
      {syncReason === undefined ? null : (
        <div className="rm-connection-result error" role="status">
          {t(
            syncReason === "not_entitled"
              ? "catalogUnavailableNotEntitled"
              : "catalogUnavailableNotInSync",
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={probing} onClick={() => void runProbe()} pending={probing}>
          {t("catalogProbeModel")}
        </Button>
        {probing ? (
          <Button
            onClick={() => probeAbort.current?.abort()}
            size="sm"
            variant="outline"
          >
            {t("cancel")}
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link search={{ auditCategory: "admin", section: "audit" }} to="/admin">
            {t("catalogViewAudit")}
          </Link>
        </Button>
      </div>
      {probeSummary === undefined ? null : (
        <StatusBadge tone="success">{probeSummary}</StatusBadge>
      )}
      {probeError === undefined ? null : (
        <div className="rm-connection-result error" role="alert">
          {probeError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(
          [
            ["tools", "tools"],
            ["reasoning", "reasoning"],
            ["imageOutput", "imageGeneration"],
            ["localOnly", "localDeployment"],
          ] as const
        ).map(([key, label]) => (
          <Checkbox
            checked={required[key]}
            key={key}
            label={t(label)}
            onCheckedChange={(checked) =>
              setRequired((current) => ({ ...current, [key]: checked === true }))
            }
          />
        ))}
      </div>
      <Button onClick={() => void preview()} size="sm" variant="outline">
        {t("catalogExplainUnavailability")}
      </Button>
      {constraint === undefined ? null : (
        <p className="text-sm" role="status">
          {constraint}
        </p>
      )}
      {provider === undefined ? null : (
        <p className="text-xs text-muted">
          {provider.name} · {provider.type}
        </p>
      )}
    </div>
  );
}

function constraintKey(
  constraint:
    | "image_output_unsupported"
    | "local_only_policy"
    | "not_entitled"
    | "reasoning_unsupported"
    | "region_outside_residency"
    | "tools_unsupported"
    | undefined,
): MessageKey {
  if (constraint === "tools_unsupported") return "catalogConstraintTools";
  if (constraint === "reasoning_unsupported") return "catalogConstraintReasoning";
  if (constraint === "image_output_unsupported") return "catalogConstraintImage";
  if (constraint === "local_only_policy") return "catalogConstraintLocalOnly";
  if (constraint === "region_outside_residency") return "catalogConstraintRegion";
  return "catalogUnavailableNotEntitled";
}
