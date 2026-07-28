import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { executeAdministrationCommand } from "./administration-commands";

describe("administration commands", () => {
  it("uses generated SDK operations for SSO, users, and groups", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const generatedClient = Object.fromEntries(
      ["delete", "get", "patch", "post"].map((method) => [
        method,
        async (options: { url: string }) => {
          requests.push({ method, url: options.url });
          return { data: { data: [] } };
        },
      ]),
    ) as never;
    const cases: Array<{ args: string[]; method: string; url: string }> = [
      {
        args: ["sso", "settings"],
        method: "get",
        url: "/admin/sso-settings",
      },
      {
        args: ["sso", "update", "--enable"],
        method: "patch",
        url: "/admin/sso-settings",
      },
      {
        args: ["sso", "test"],
        method: "post",
        url: "/admin/sso-settings/test",
      },
      {
        args: [
          "sso",
          "deprovision-oidc",
          "--subject",
          "subject_1",
          "--confirm-subject",
          "subject_1",
        ],
        method: "post",
        url: "/admin/sso/oidc/deprovision",
      },
      { args: ["users", "list"], method: "get", url: "/users" },
      {
        args: ["users", "disable", "--user", "user_1"],
        method: "post",
        url: "/users/{userId}/disable",
      },
      { args: ["groups", "list"], method: "get", url: "/groups" },
      {
        args: ["groups", "create", "--name", "Reviewers"],
        method: "post",
        url: "/groups",
      },
      {
        args: ["groups", "members", "--group", "group_1"],
        method: "get",
        url: "/groups/{groupId}/members",
      },
      {
        args: [
          "groups",
          "add-member",
          "--group",
          "group_1",
          "--user",
          "user_1",
        ],
        method: "post",
        url: "/groups/{groupId}/members",
      },
      {
        args: [
          "groups",
          "remove-member",
          "--group",
          "group_1",
          "--user",
          "user_1",
        ],
        method: "delete",
        url: "/groups/{groupId}/members/{userId}",
      },
    ];

    for (const testCase of cases) {
      await expect(
        executeAdministrationCommand(testCase.args[0]!, testCase.args[1], {
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
