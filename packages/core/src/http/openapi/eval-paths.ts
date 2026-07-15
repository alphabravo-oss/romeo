import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const evalPaths = {
  "/agents/{agentId}/eval-suites": {
    get: {
      summary: "List eval suites for an agent",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      responses: {
        200: arrayEnvelope("Eval suite"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/eval-suites": {
    post: {
      summary: "Create an eval suite",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateEvalSuiteRequest",
        }),
      },
      responses: {
        201: created("Eval suite"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/agents/{agentId}/eval-runs": {
    get: {
      summary: "List eval runs for an agent",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      responses: {
        200: arrayEnvelope("Eval run"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/agents/{agentId}/eval-dashboard": {
    get: {
      summary: "Summarize historical eval runs for an agent",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      responses: {
        200: success("Eval dashboard summary"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/agents/{agentId}/eval-release-candidate-evidence": {
    get: {
      summary:
        "Generate metadata-only release-candidate eval evidence for an agent",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      responses: {
        200: success("Eval release candidate evidence", {
          $ref: "#/components/schemas/EvalReleaseCandidateEvidence",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/eval-suites/{suiteId}/runs": {
    post: {
      summary: "Run an eval suite against an agent draft",
      parameters: [{ $ref: "#/components/parameters/EvalSuiteId" }],
      requestBody: {
        required: false,
        content: jsonContent({
          $ref: "#/components/schemas/RunEvalSuiteRequest",
        }),
      },
      responses: {
        202: created("Eval run with results"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/eval-suites/{suiteId}/model-comparisons": {
    post: {
      summary: "Run an eval suite across multiple models",
      parameters: [{ $ref: "#/components/parameters/EvalSuiteId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CompareEvalModelsRequest",
        }),
      },
      responses: {
        202: created("Eval model comparison"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/eval-runs/{runId}/results": {
    get: {
      summary: "List eval run results",
      parameters: [{ $ref: "#/components/parameters/EvalRunId" }],
      responses: {
        200: arrayEnvelope("Eval run result"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/eval-runs/{runId}/ratings": {
    get: {
      summary: "List human ratings for an eval run",
      parameters: [{ $ref: "#/components/parameters/EvalRunId" }],
      responses: {
        200: arrayEnvelope("Eval result human rating"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/eval-run-results/{resultId}/rating": {
    post: {
      summary: "Rate an eval run result",
      parameters: [
        {
          name: "resultId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/RateEvalResultRequest",
        }),
      },
      responses: {
        200: success("Eval result human rating"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
