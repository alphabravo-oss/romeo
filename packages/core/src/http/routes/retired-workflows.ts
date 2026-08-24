import {
  approveWorkflowRunRoute,
  createWorkflowFromTemplateRoute,
  createWorkflowRoute,
  listWorkflowRunsRoute,
  listWorkflowTemplatesRoute,
  listWorkflowsRoute,
  resumeWorkflowRunRoute,
  runDueWorkflowSchedulesRoute,
  startWorkflowRunRoute,
} from "@romeo/contracts";

import { ApiError } from "../../errors";
import type { RomeoApi } from "../context";

/**
 * Compatibility tombstones for the retired workflow feature. Keeping the
 * authenticated endpoints during the published deprecation window gives old
 * clients deterministic remediation while preventing new workflow execution.
 */
export function registerRetiredWorkflowRoutes(app: RomeoApi): void {
  app.openapi(listWorkflowTemplatesRoute, retiredWorkflow);
  app.openapi(createWorkflowFromTemplateRoute, retiredWorkflow);
  app.openapi(listWorkflowsRoute, retiredWorkflow);
  app.openapi(createWorkflowRoute, retiredWorkflow);
  app.openapi(runDueWorkflowSchedulesRoute, retiredWorkflow);
  app.openapi(listWorkflowRunsRoute, retiredWorkflow);
  app.openapi(startWorkflowRunRoute, retiredWorkflow);
  app.openapi(approveWorkflowRunRoute, retiredWorkflow);
  app.openapi(resumeWorkflowRunRoute, retiredWorkflow);
}

function retiredWorkflow(): never {
  throw new ApiError(
    "workflow_feature_retired",
    "Workflow APIs are retired. Existing workflow records remain governed and exportable during the deprecation window.",
    409,
    {
      documentationUrl: "https://docs.romeo.ai/api/workflow-retirement",
      sunsetAt: "2027-02-23T00:00:00.000Z",
    },
  );
}
