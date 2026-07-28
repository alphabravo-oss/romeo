import { createRoute, z } from "@hono/zod-openapi";

import {
  BrowserAutomationArtifactUploadRegistrationSchema,
  BrowserAutomationTaskClaimResultSchema,
  BrowserAutomationTaskExpiryResultSchema,
  BrowserAutomationTaskReadbackResultSchema,
  ClaimBrowserAutomationTaskRequestSchema,
  CompleteBrowserAutomationTaskRequestSchema,
  CreateBrowserAutomationArtifactUploadRequestSchema,
  ExpireBrowserAutomationTasksRequestSchema,
  FailBrowserAutomationTaskRequestSchema,
  browserAutomationArtifactParams,
  browserAutomationJobParams,
} from "./browser-automation-schemas";
import { BrowserAutomationPostureReportSchema } from "./browser-automation-posture";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

export * from "./browser-automation-schemas";
export * from "./browser-automation-posture";

const metadata = {
  tags: ["Browser Automation"],
  security: authenticationSecurity,
};
const body = <T extends z.ZodType>(schema: T, required = true) => ({
  required,
  content: { "application/json": { schema } },
});
const response = <T extends z.ZodType>(description: string, schema: T) =>
  jsonResponse(description, dataEnvelope(schema));

export const getBrowserAutomationPostureRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/admin/browser-automation/posture",
  operationId: "browserAutomation.getPosture",
  summary: "Get sanitized browser automation operational posture",
  responses: {
    200: response(
      "Browser automation posture",
      BrowserAutomationPostureReportSchema,
    ),
    ...standardErrorResponses,
  },
});

export const claimBrowserAutomationTaskRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/browser-automation-tasks/claim",
  operationId: "browserAutomation.claimTask",
  summary: "Claim an approved browser automation task",
  request: { body: body(ClaimBrowserAutomationTaskRequestSchema, false) },
  responses: {
    200: response(
      "Browser automation task claim",
      BrowserAutomationTaskClaimResultSchema,
    ),
    ...standardErrorResponses,
  },
});

export const renewBrowserAutomationTaskLeaseRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/browser-automation-tasks/{jobId}/renew-lease",
  operationId: "browserAutomation.renewTaskLease",
  summary: "Renew an active browser automation task lease",
  request: {
    params: browserAutomationJobParams,
    body: body(ClaimBrowserAutomationTaskRequestSchema, false),
  },
  responses: {
    200: response(
      "Renewed browser automation task claim",
      BrowserAutomationTaskClaimResultSchema,
    ),
    ...standardErrorResponses,
  },
});

export const createBrowserAutomationArtifactUploadRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/browser-automation-tasks/{jobId}/artifacts/uploads",
  operationId: "browserAutomation.createArtifactUpload",
  summary: "Register a browser automation artifact upload",
  request: {
    params: browserAutomationJobParams,
    body: body(CreateBrowserAutomationArtifactUploadRequestSchema),
  },
  responses: {
    202: response(
      "Browser automation artifact upload registration",
      BrowserAutomationArtifactUploadRegistrationSchema,
    ),
    ...standardErrorResponses,
  },
});

const browserArtifactBinaryContent = Object.fromEntries(
  [
    "application/gzip",
    "application/json",
    "application/octet-stream",
    "application/x-ndjson",
    "application/zip",
    "image/jpeg",
    "image/png",
    "image/webp",
  ].map((contentType) => [
    contentType,
    { schema: z.string().openapi({ format: "binary" }) },
  ]),
);

export const readBrowserAutomationArtifactRoute = createRoute({
  ...metadata,
  method: "get",
  path: "/api/v1/browser-automation-artifacts/{artifactId}",
  operationId: "browserAutomation.readArtifact",
  summary: "Read an authorized browser automation artifact",
  request: { params: browserAutomationArtifactParams },
  responses: {
    200: {
      description: "Browser automation artifact bytes",
      content: browserArtifactBinaryContent,
    },
    ...standardErrorResponses,
  },
});

export const completeBrowserAutomationTaskRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/browser-automation-tasks/{jobId}/complete",
  operationId: "browserAutomation.completeTask",
  summary: "Complete an active browser automation task",
  request: {
    params: browserAutomationJobParams,
    body: body(CompleteBrowserAutomationTaskRequestSchema),
  },
  responses: {
    200: response(
      "Completed browser automation task",
      BrowserAutomationTaskReadbackResultSchema,
    ),
    ...standardErrorResponses,
  },
});

export const failBrowserAutomationTaskRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/browser-automation-tasks/{jobId}/fail",
  operationId: "browserAutomation.failTask",
  summary: "Fail an active browser automation task",
  request: {
    params: browserAutomationJobParams,
    body: body(FailBrowserAutomationTaskRequestSchema),
  },
  responses: {
    200: response(
      "Failed browser automation task",
      BrowserAutomationTaskReadbackResultSchema,
    ),
    ...standardErrorResponses,
  },
});

export const expireBrowserAutomationTasksRoute = createRoute({
  ...metadata,
  method: "post",
  path: "/api/v1/browser-automation-tasks/expire",
  operationId: "browserAutomation.expireTasks",
  summary: "Expire stale browser automation tasks",
  request: { body: body(ExpireBrowserAutomationTasksRequestSchema, false) },
  responses: {
    200: response(
      "Expired browser automation tasks",
      BrowserAutomationTaskExpiryResultSchema,
    ),
    ...standardErrorResponses,
  },
});

export const browserAutomationRoutes = [
  getBrowserAutomationPostureRoute,
  claimBrowserAutomationTaskRoute,
  renewBrowserAutomationTaskLeaseRoute,
  createBrowserAutomationArtifactUploadRoute,
  readBrowserAutomationArtifactRoute,
  completeBrowserAutomationTaskRoute,
  failBrowserAutomationTaskRoute,
  expireBrowserAutomationTasksRoute,
] as const;
