import { Input, Textarea, NativeSelect, Button } from "@romeo/ui";
import type { WorkflowStepType } from "../features/workflows";
import { STEP_TYPE_OPTIONS, type StepDraft } from "./workflow-step-builder";
import { useLocale } from "../lib/i18n";

/**
 * Controlled editor for a workflow's steps. Parent owns the draft array; this
 * renders per-type fields and add/remove/move controls. Validation and step
 * construction live in ./workflow-step-builder (buildWorkflowSteps).
 */
export function WorkflowStepBuilder({
  drafts,
  onChange,
  onAdd,
}: {
  drafts: StepDraft[];
  onChange: (drafts: StepDraft[]) => void;
  onAdd: () => void;
}) {
  const { t } = useLocale();
  const stepTypeLabel = (type: WorkflowStepType) =>
    ({
      agent_run: t("agentRun"),
      agent_handoff: t("agentHandoff"),
      agent_room: t("agentRoom"),
      approval: t("approvalGate"),
      tool_approval: t("toolApproval"),
      browser_task: t("browserTask"),
      notification: t("notificationStep"),
    })[type];
  function update(index: number, patch: Partial<StepDraft>) {
    onChange(
      drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  function remove(index: number) {
    onChange(drafts.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= drafts.length) return;
    const copy = drafts.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item!);
    onChange(copy);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{t("steps")}</div>
        <Button onClick={onAdd} type="button">
          + {t("addStep")}
        </Button>
      </div>
      {drafts.length === 0 ? (
        <div className="rm-empty">{t("noSteps")}</div>
      ) : null}
      {drafts.map((draft, index) => (
        <div
          className="grid gap-2 border border-border rounded p-3"
          key={draft.key}
        >
          <div className="flex items-center gap-2">
            <span className="rm-mono text-xs text-muted">step_{index + 1}</span>
            <NativeSelect
              onChange={(event) =>
                update(index, {
                  type: event.currentTarget.value as WorkflowStepType,
                })
              }
              value={draft.type}
            >
              {STEP_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {stepTypeLabel(option.value)}
                </option>
              ))}
            </NativeSelect>
            <div className="ml-auto flex gap-1">
              <Button
                disabled={index === 0}
                onClick={() => move(index, -1)}
                type="button"
                aria-label={t("moveUp")}
              >
                ↑
              </Button>
              <Button
                disabled={index === drafts.length - 1}
                onClick={() => move(index, 1)}
                type="button"
                aria-label={t("moveDown")}
              >
                ↓
              </Button>
              <Button
                variant="danger"
                onClick={() => remove(index)}
                type="button"
                aria-label={t("removeStep")}
              >
                {t("remove")}
              </Button>
            </div>
          </div>

          <Input
            onChange={(event) =>
              update(index, { name: event.currentTarget.value })
            }
            placeholder={t("stepName")}
            value={draft.name}
          />

          {draft.type === "agent_run" || draft.type === "agent_handoff" ? (
            <Input
              onChange={(event) =>
                update(index, { agentId: event.currentTarget.value })
              }
              placeholder={t("agentId")}
              value={draft.agentId}
            />
          ) : null}

          {draft.type === "agent_handoff" ? (
            <>
              <NativeSelect
                onChange={(event) =>
                  update(index, {
                    handoffFromStepId: event.currentTarget.value,
                  })
                }
                value={draft.handoffFromStepId}
              >
                <option value="">{t("handoffPrevious")}</option>
                {drafts.slice(0, index).map((_, earlier) => (
                  <option key={earlier} value={`step_${earlier + 1}`}>
                    step_{earlier + 1}
                  </option>
                ))}
              </NativeSelect>
              <Input
                onChange={(event) =>
                  update(index, { handoffPrompt: event.currentTarget.value })
                }
                placeholder={t("handoffPromptOptional")}
                value={draft.handoffPrompt}
              />
            </>
          ) : null}

          {draft.type === "agent_room" ? (
            <>
              <Textarea
                onChange={(event) =>
                  update(index, { agentIds: event.currentTarget.value })
                }
                placeholder={t("agentIdsRoom")}
                rows={2}
                value={draft.agentIds}
              />
              <Input
                onChange={(event) =>
                  update(index, { roomPrompt: event.currentTarget.value })
                }
                placeholder={t("roomPromptOptional")}
                value={draft.roomPrompt}
              />
            </>
          ) : null}

          {draft.type === "approval" ? (
            <Input
              onChange={(event) =>
                update(index, { approvalPrompt: event.currentTarget.value })
              }
              placeholder={t("approvalPromptOptional")}
              value={draft.approvalPrompt}
            />
          ) : null}

          {draft.type === "tool_approval" ? (
            <>
              <Input
                onChange={(event) =>
                  update(index, { toolChainName: event.currentTarget.value })
                }
                placeholder={t("toolChainOptional")}
                value={draft.toolChainName}
              />
              <NativeSelect
                onChange={(event) =>
                  update(index, {
                    riskLevel: event.currentTarget
                      .value as StepDraft["riskLevel"],
                  })
                }
                value={draft.riskLevel}
              >
                <option value="">{t("riskLevelOptional")}</option>
                <option value="low">{t("low")}</option>
                <option value="medium">{t("medium")}</option>
                <option value="high">{t("high")}</option>
              </NativeSelect>
              <Input
                onChange={(event) =>
                  update(index, { inputKeys: event.currentTarget.value })
                }
                placeholder={t("inputKeysOptional")}
                value={draft.inputKeys}
              />
              <Input
                onChange={(event) =>
                  update(index, { approvalPrompt: event.currentTarget.value })
                }
                placeholder={t("approvalPromptOptional")}
                value={draft.approvalPrompt}
              />
            </>
          ) : null}

          {draft.type === "browser_task" ? (
            <>
              <Input
                onChange={(event) =>
                  update(index, { targetUrl: event.currentTarget.value })
                }
                placeholder={t("targetUrl")}
                value={draft.targetUrl}
              />
              <Input
                onChange={(event) =>
                  update(index, { task: event.currentTarget.value })
                }
                placeholder={t("taskDescription")}
                value={draft.task}
              />
              <Input
                onChange={(event) =>
                  update(index, { approvalPrompt: event.currentTarget.value })
                }
                placeholder={t("approvalPromptOptional")}
                value={draft.approvalPrompt}
              />
            </>
          ) : null}

          {draft.type === "notification" ? (
            <Input
              onChange={(event) =>
                update(index, { message: event.currentTarget.value })
              }
              placeholder={t("messageOptional")}
              value={draft.message}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
