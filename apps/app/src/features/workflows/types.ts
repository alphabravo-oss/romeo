export type {
  ApproveWorkflowRunRequest,
  CreateWorkflowFromTemplateRequest,
  CreateWorkflowRequest,
  CreateWorkflowStep,
  StartWorkflowRunRequest,
  Workflow,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSchedule,
  WorkflowScheduleRunResult,
  WorkflowStep,
  WorkflowStepRun,
  WorkflowStepRunStatus,
  WorkflowStepType,
  WorkflowTemplate,
  WorkflowTemplateStep,
} from "@romeo/api-client/generated/sdk";

export type WorkflowScheduleInput = NonNullable<
  import("@romeo/api-client/generated/sdk").CreateWorkflowRequest["schedule"]
>;
export type CreateWorkflowInput = Omit<
  import("@romeo/api-client/generated/sdk").CreateWorkflowRequest,
  "steps"
> & {
  steps: import("@romeo/api-client/generated/sdk").WorkflowStep[];
};
export type CreateWorkflowFromTemplateInput =
  import("@romeo/api-client/generated/sdk").CreateWorkflowFromTemplateRequest & {
    templateId: string;
  };
export type StartWorkflowRunInput =
  import("@romeo/api-client/generated/sdk").StartWorkflowRunRequest & {
    workflowId: string;
  };
