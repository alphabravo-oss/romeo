import { Button, Input, NativeSelect, StatusBadge } from "@romeo/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  simulateAbuseControlsMutationOptions,
  type AbuseControlSimulationResult,
  type SimulateAbuseControlPolicyRequest,
} from "../features/admin-insights";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";

const abuseActions: SimulateAbuseControlPolicyRequest["action"][] = [
  "run.start",
  "model.request",
  "tool.execute",
  "tool.dispatch",
  "connector.sync",
  "knowledge.ingest",
  "file.upload",
  "eval.run",
  "voice.request",
  "workflow.run",
  "worker.enqueue",
];

type SimulationTarget = Exclude<
  keyof SimulateAbuseControlPolicyRequest,
  "action"
>;
const simulationTargets: SimulationTarget[] = [
  "providerId",
  "agentId",
  "connectorId",
  "toolId",
  "workerClass",
  "workspaceId",
];

export function AbusePolicySimulator() {
  const { t } = useLocale();
  const [action, setAction] =
    useState<SimulateAbuseControlPolicyRequest["action"]>("run.start");
  const [target, setTarget] = useState<SimulationTarget>("providerId");
  const [targetId, setTargetId] = useState("");
  const [result, setResult] = useState<AbuseControlSimulationResult>();
  const simulation = useMutation(simulateAbuseControlsMutationOptions());

  async function runSimulation() {
    const trimmed = targetId.trim();
    const input = {
      action,
      ...(trimmed === "" ? {} : { [target]: trimmed }),
    } as SimulateAbuseControlPolicyRequest;
    try {
      setResult(await simulation.mutateAsync(input));
    } catch {
      toast(t("abuseSimulationFailed"), "error");
    } finally {
      simulation.reset();
    }
  }

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <div>
        <div className="rm-card-title">{t("abuseSimulatorTitle")}</div>
        <p className="text-sm text-muted">{t("abuseSimulatorDescription")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted">{t("abuseSimulationAction")}</span>
          <NativeSelect
            name="simulationAction"
            onChange={(event) =>
              setAction(
                event.currentTarget
                  .value as SimulateAbuseControlPolicyRequest["action"],
              )
            }
            value={action}
          >
            {abuseActions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">{t("abuseSimulationTarget")}</span>
          <NativeSelect
            name="simulationTarget"
            onChange={(event) =>
              setTarget(event.currentTarget.value as SimulationTarget)
            }
            value={target}
          >
            {simulationTargets.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">{t("abuseSimulationTargetId")}</span>
          <Input
            name="simulationTargetId"
            onChange={(event) => setTargetId(event.currentTarget.value)}
            placeholder={t("abuseSimulationOptional")}
            value={targetId}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void runSimulation()}
          pending={simulation.isPending}
          type="button"
        >
          {t("abuseRunSimulation")}
        </Button>
        {result === undefined ? null : (
          <div aria-live="polite" className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={result.allowed ? "success" : "danger"}>
              {result.allowed ? t("abuseAllowed") : t("abuseBlocked")}
            </StatusBadge>
            <span className="text-sm text-muted">
              {result.reasonCodes.length === 0
                ? t("abuseSimulationNoBlocks")
                : result.reasonCodes.join(", ")}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
