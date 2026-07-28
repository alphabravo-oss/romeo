import { Button, Field, Input, NativeSelect } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  approveWorkflowRun,
  createWorkflow,
  createWorkflowFromTemplate,
  listWorkflowRuns,
  listWorkflowTemplates,
  listWorkflows,
  resumeWorkflowRun,
  startWorkflowRun,
} from "../features/workflows";
import type { WorkflowScheduleInput } from "../features/workflows";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";
import { DataTable } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { PanelStats } from "./PanelStats";
import { WorkflowStepBuilder } from "./WorkflowStepBuilder";
import {
  type StepDraft,
  buildWorkflowSteps,
  newStepDraft,
} from "./workflow-step-builder";
import { useWorkspace } from "./WorkspaceContext";
import { useWorkflowColumns } from "./useWorkflowColumns";

export function WorkflowsPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<
    string | undefined
  >(undefined);

  const workflowsQuery = useQuery({
    queryKey: ["workflows", workspaceId],
    queryFn: () => listWorkflows(workspaceId),
    enabled: workspaceId !== undefined,
  });
  const templatesQuery = useQuery({
    queryKey: ["workflowTemplates", workspaceId],
    queryFn: listWorkflowTemplates,
  });
  const runsQuery = useQuery({
    queryKey: ["workflowRuns", selectedWorkflowId],
    queryFn: () => listWorkflowRuns(selectedWorkflowId!),
    enabled: selectedWorkflowId !== undefined,
  });

  const createMutation = useMutation({
    mutationFn: createWorkflowFromTemplate,
  });
  const createWorkflowMutation = useMutation({ mutationFn: createWorkflow });
  const startRunMutation = useMutation({ mutationFn: startWorkflowRun });
  const approveMutation = useMutation({ mutationFn: approveWorkflowRun });
  const resumeMutation = useMutation({ mutationFn: resumeWorkflowRun });

  const createForm = useForm({
    defaultValues: {
      templateId: "",
      agentId: "",
    },
    onSubmit: async ({ value }) => {
      if (workspaceId === undefined) {
        toast(t("noWorkspaceSelected"), "error");
        return;
      }
      try {
        await createMutation.mutateAsync({
          templateId: value.templateId,
          workspaceId,
          ...(value.agentId.trim() ? { agentId: value.agentId.trim() } : {}),
        });
        await queryClient.invalidateQueries({
          queryKey: ["workflows", workspaceId],
        });
        toast(t("workflowCreated"), "success");
        createForm.reset();
        setAddOpen(false);
      } catch (caught) {
        toast(t("couldNotCreateWorkflow"), "error");
        throw caught;
      }
    },
  });

  // Multi-step builder state. Step keys are stable ids for React only; the
  // backend assigns the real step ids in order (buildWorkflowSteps mirrors that).
  const stepKey = useRef(0);
  const makeDraft = (): StepDraft => {
    stepKey.current += 1;
    return newStepDraft(`k${stepKey.current}`);
  };
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [drafts, setDrafts] = useState<StepDraft[]>(() => [makeDraft()]);

  function resetNewWorkflow() {
    setNewName("");
    setNewDescription("");
    setScheduleEnabled(false);
    setIntervalMinutes("60");
    stepKey.current = 0;
    setDrafts([makeDraft()]);
  }

  function localizedStepError(error: string): string {
    if (error === "Add at least one step.") return t("addAtLeastOneStep");
    const match = /^Step (\d+): (.*)$/u.exec(error);
    if (!match) return error;
    const detail = match[2]!;
    const fixed = new Map([
      ["name is required.", t("stepNameRequired")],
      ["name is too long (max 120).", t("stepNameTooLong")],
      ["agent id is required.", t("stepAgentRequired")],
      ["handoff source must be an earlier step.", t("handoffEarlierRequired")],
      ["add at least 2 agent ids.", t("addAtLeastTwoAgents")],
      ["at most 5 agent ids.", t("atMostFiveAgents")],
      ["agent ids must be unique.", t("agentIdsUnique")],
      ["target URL is required.", t("targetUrlRequired")],
      ["target URL is not a valid URL.", t("targetUrlInvalid")],
      ["task is required.", t("taskRequired")],
      ["unknown step type.", t("unknownStepType")],
    ]);
    const invalidKey = /^invalid input key (".*")\.$/u.exec(detail);
    const translated = invalidKey
      ? `${t("invalidInputKey")} ${invalidKey[1]}.`
      : (fixed.get(detail) ?? detail);
    return `${t("stepLabel")} ${match[1]}: ${translated}`;
  }

  async function handleCreateWorkflow(): Promise<void> {
    if (workspaceId === undefined) {
      toast(t("noWorkspaceSelected"), "error");
      return;
    }
    const name = newName.trim();
    if (!name) {
      toast(t("workflowNameRequired"), "error");
      return;
    }
    const built = buildWorkflowSteps(drafts);
    if (!built.ok) {
      toast(localizedStepError(built.error), "error");
      return;
    }
    const description = newDescription.trim();
    let schedule: WorkflowScheduleInput | undefined;
    if (scheduleEnabled) {
      const minutes = Number(intervalMinutes);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 43_200) {
        toast(t("scheduleIntervalInvalid"), "error");
        return;
      }
      schedule = { enabled: true, intervalMinutes: minutes };
    }
    try {
      await createWorkflowMutation.mutateAsync({
        workspaceId,
        name,
        steps: built.steps,
        ...(description ? { description } : {}),
        ...(schedule ? { schedule } : {}),
      });
      await queryClient.invalidateQueries({
        queryKey: ["workflows", workspaceId],
      });
      toast(t("workflowCreated"), "success");
      resetNewWorkflow();
      setNewOpen(false);
    } catch {
      toast(t("couldNotCreateWorkflow"), "error");
    }
  }

  async function handleRun(workflowId: string) {
    try {
      await startRunMutation.mutateAsync({ workflowId });
      await queryClient.invalidateQueries({
        queryKey: ["workflowRuns", workflowId],
      });
      toast(t("runStarted"), "success");
    } catch {
      toast(t("couldNotStartRun"), "error");
    }
  }

  async function handleApprove(workflowRunId: string) {
    try {
      await approveMutation.mutateAsync(workflowRunId);
      await queryClient.invalidateQueries({
        queryKey: ["workflowRuns", selectedWorkflowId],
      });
      toast(t("runApproved"), "success");
    } catch {
      toast(t("couldNotApproveRun"), "error");
    }
  }

  async function handleResume(workflowRunId: string) {
    try {
      await resumeMutation.mutateAsync(workflowRunId);
      await queryClient.invalidateQueries({
        queryKey: ["workflowRuns", selectedWorkflowId],
      });
      toast(t("runResumed"), "success");
    } catch {
      toast(t("couldNotResumeRun"), "error");
    }
  }

  const { runColumns, templateColumns, workflowColumns } = useWorkflowColumns({
    approvePending: approveMutation.isPending,
    onApprove: (workflowRunId) => void handleApprove(workflowRunId),
    onResume: (workflowRunId) => void handleResume(workflowRunId),
    onRun: (workflowId) => void handleRun(workflowId),
    onSelect: setSelectedWorkflowId,
    resumePending: resumeMutation.isPending,
    startPending: startRunMutation.isPending,
  });

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("workflows")}</div>
        <div className="flex gap-2">
          <Button
            disabled={workflowsQuery.isFetching}
            onClick={() => void workflowsQuery.refetch()}
            type="button"
          >
            {workflowsQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
          <Button onClick={() => setAddOpen(true)} type="button">
            + {t("fromTemplate")}
          </Button>
          <Button
            variant="primary"
            onClick={() => setNewOpen(true)}
            type="button"
          >
            + {t("newWorkflow")}
          </Button>
        </div>
      </div>

      <FormDialog
        open={addOpen}
        title={t("newWorkflow")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void createForm.handleSubmit();
          }}
        >
          <div className="text-sm text-muted">{t("createFromTemplate")}</div>
          <createForm.Field
            name="templateId"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value ? t("templateRequired") : undefined,
            }}
          >
            {(field) => (
              <Field
                error={
                  field.state.meta.errors.length
                    ? field.state.meta.errors.join(", ")
                    : undefined
                }
                label={t("template")}
              >
                <NativeSelect
                  name="templateId"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  value={field.state.value}
                >
                  <option value="">{t("selectTemplate")}</option>
                  {(templatesQuery.data ?? []).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </createForm.Field>
          <createForm.Field name="agentId">
            {(field) => (
              <Input
                name="agentId"
                aria-label={t("agentIdOptional")}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={t("agentIdOptional")}
                value={field.state.value}
              />
            )}
          </createForm.Field>
          <createForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? t("creating") : t("createWorkflow")}
              </Button>
            )}
          </createForm.Subscribe>
        </form>
      </FormDialog>

      <FormDialog
        open={newOpen}
        title={t("newWorkflow")}
        onClose={() => setNewOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleCreateWorkflow();
          }}
        >
          <Input
            name="newName"
            aria-label={t("workflowName")}
            onChange={(event) => setNewName(event.currentTarget.value)}
            placeholder={t("workflowName")}
            value={newName}
          />
          <Input
            name="newDescription"
            aria-label={t("descriptionOptional")}
            onChange={(event) => setNewDescription(event.currentTarget.value)}
            placeholder={t("descriptionOptional")}
            value={newDescription}
          />

          <WorkflowStepBuilder
            drafts={drafts}
            onAdd={() => setDrafts((prev) => [...prev, makeDraft()])}
            onChange={setDrafts}
          />

          <label className="flex items-center gap-2 text-sm">
            <Input
              name="scheduleEnabled"
              checked={scheduleEnabled}
              onChange={(event) =>
                setScheduleEnabled(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>{t("runOnSchedule")}</span>
          </label>
          {scheduleEnabled ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">{t("intervalMinutes")}</span>
              <Input
                name="intervalMinutes"
                max={43_200}
                min={5}
                onChange={(event) =>
                  setIntervalMinutes(event.currentTarget.value)
                }
                type="number"
                value={intervalMinutes}
              />
            </label>
          ) : null}

          <Button
            variant="primary"
            disabled={createWorkflowMutation.isPending}
            type="submit"
          >
            {createWorkflowMutation.isPending
              ? t("creating")
              : t("createWorkflow")}
          </Button>
        </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          empty={t("noWorkflows")}
          emptyAction={
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              + {t("createWorkflow")}
            </Button>
          }
          query={workflowsQuery}
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: t("totalWorkflows"), value: rows.length },
                  {
                    label: t("enabled"),
                    value: rows.filter((row) => row.enabled).length,
                  },
                  {
                    label: t("templates"),
                    value: (templatesQuery.data ?? []).length,
                  },
                ]}
              />
              <DataTable columns={workflowColumns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>

      <div className="mt-4">
        <div className="rm-card-title">{t("templates")}</div>
        <PanelState query={templatesQuery} empty={t("noTemplatesAvailable")}>
          {(rows) => <DataTable columns={templateColumns} data={rows} />}
        </PanelState>
      </div>

      {selectedWorkflowId !== undefined ? (
        <div className="mt-4">
          <div className="rm-card-header">
            <div className="rm-card-title">{t("runs")}</div>
            <Button
              onClick={() => setSelectedWorkflowId(undefined)}
              type="button"
            >
              {t("close")}
            </Button>
          </div>
          <DataTable
            columns={runColumns}
            data={runsQuery.data ?? []}
            empty={t("noRunsForWorkflow")}
          />
        </div>
      ) : null}
    </section>
  );
}
