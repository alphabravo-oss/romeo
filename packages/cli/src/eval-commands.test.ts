import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeEvalCommand } from "./eval-commands";

describe("evaluation commands", () => {
  it("uses generated SDK operations for the single-model evaluation lifecycle", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = Object.fromEntries(
      ["get", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return { data: { data: [] } };
        },
      ]),
    ) as never;
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      {
        args: ["evals", "list", "--agent", "agent_1"],
        method: "get",
        url: "/agents/{agentId}/eval-suites",
      },
      {
        args: ["evals", "runs", "--agent", "agent_1"],
        method: "get",
        url: "/agents/{agentId}/eval-runs",
      },
      {
        args: ["evals", "dashboard", "--agent", "agent_1"],
        method: "get",
        url: "/agents/{agentId}/eval-dashboard",
      },
      {
        args: [
          "evals",
          "create",
          "--agent",
          "agent_1",
          "--prompt",
          "Question",
          "--expected",
          "Answer",
        ],
        method: "post",
        url: "/eval-suites",
      },
      {
        args: ["evals", "run", "--suite", "suite_1"],
        method: "post",
        url: "/eval-suites/{suiteId}/runs",
      },
      {
        args: ["evals", "ratings", "--run", "run_1"],
        method: "get",
        url: "/eval-runs/{runId}/ratings",
      },
      {
        args: ["evals", "rate", "--result", "result_1", "--rating", "pass"],
        method: "post",
        url: "/eval-run-results/{resultId}/rating",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeEvalCommand("evals", testCase.args[1], {
          generatedClient,
          io: {
            stdout: { write: () => true },
            stderr: { write: () => true },
          },
          parsed: parseArgs(testCase.args),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(cases.map(({ method, url }) => ({ method, url })));
  });
});
