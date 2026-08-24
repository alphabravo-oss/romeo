import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeBrowserTaskCommand } from "./browser-task-commands";

describe("browser task commands", () => {
  it("uses generated SDK operations and only fetches pre-signed uploads directly", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = {
      post: async (options: { url: string }) => {
        requests.push({ method: "post", url: options.url });
        return options.url.endsWith("/artifacts/uploads")
          ? {
              data: {
                data: {
                  artifact: { artifactId: "artifact_1", type: "trace" },
                  upload: {
                    url: "https://objects.example/upload",
                    method: "PUT",
                    headers: {},
                  },
                },
              },
            }
          : { data: { data: [] } };
      },
    } as never;
    const uploads: string[] = [];
    const cases: Array<{ args: string[]; url: string }> = [
      {
        args: ["browser-automation", "browser-task-claim"],
        url: "/browser-automation-tasks/claim",
      },
      {
        args: ["browser-automation", "browser-task-renew", "--job", "job_1"],
        url: "/browser-automation-tasks/{jobId}/renew-lease",
      },
      {
        args: [
          "browser-automation",
          "browser-artifact-upload",
          "--job",
          "job_1",
          "--file",
          "trace.zip",
          "--type",
          "trace",
        ],
        url: "/browser-automation-tasks/{jobId}/artifacts/uploads",
      },
      {
        args: ["browser-automation", "browser-tasks-expire"],
        url: "/browser-automation-tasks/expire",
      },
      {
        args: ["browser-automation", "browser-task-complete", "--job", "job_1"],
        url: "/browser-automation-tasks/{jobId}/complete",
      },
      {
        args: [
          "browser-automation",
          "browser-task-fail",
          "--job",
          "job_1",
          "--error-code",
          "failed",
        ],
        url: "/browser-automation-tasks/{jobId}/fail",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeBrowserTaskCommand("browser-automation", testCase.args[1], {
          fetchImpl: async (input) => {
            uploads.push(String(input));
            return new Response(null, { status: 200 });
          },
          generatedClient,
          io: {
            stdout: { write: () => true },
            stderr: { write: () => true },
          },
          parsed: parseArgs(testCase.args),
          readFile: async () => new Uint8Array([1, 2, 3]),
        }),
      ).resolves.toBe(0);
    }

    expect(requests).toEqual(cases.map(({ url }) => ({ method: "post", url })));
    expect(uploads).toEqual(["https://objects.example/upload"]);
  });
});
