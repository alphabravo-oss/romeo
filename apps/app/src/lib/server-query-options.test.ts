import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { favoritesQueryOptions } from "../features/collaboration";
import { routerSessionSnapshotQueryOptions } from "./router-runtime-data";
import { queryCacheProfiles } from "./query-cache-policy";
import { abortableQuery, serverQueryPolicy } from "./server-query-options";

describe("server query option contracts", () => {
  it("applies one named cache profile and browser-only dehydration metadata", () => {
    const policy = serverQueryPolicy("interactive", "folders", {
      workspaceId: "workspace-1",
    });

    expect(policy).toMatchObject(queryCacheProfiles.interactive);
    expect(policy.meta).toMatchObject({
      ssr: false,
      queryDiagnostic: {
        dimensions: { workspaceId: "workspace-1" },
        resource: "folders",
      },
    });
    expect(favoritesQueryOptions()).toMatchObject({
      ...queryCacheProfiles.interactive,
      meta: { ssr: false },
    });
  });

  it("keeps only an explicit sanitized route snapshot eligible for SSR", () => {
    const options = routerSessionSnapshotQueryOptions({
      locale: "en",
      session: { authenticated: true, kind: "session" },
      subject: {
        id: "user-1",
        isAdmin: false,
        orgId: "org-1",
        type: "user",
        workspaceIds: ["workspace-1"],
      },
      workspaces: [
        {
          id: "workspace-1",
          name: "Workspace 1",
          orgId: "org-1",
          slug: "workspace-1",
        },
      ],
    });

    expect(options.meta?.ssr).toBe(true);
    expect(options.queryKey).toEqual(["routerSession", "en"]);
  });

  it("rejects an aborted late response before it can commit to cache", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => {
      resolve = done;
    });
    const request = queryClient.fetchQuery({
      queryKey: ["abort-contract"],
      queryFn: ({ signal }) => abortableQuery(signal, () => response),
    });

    await queryClient.cancelQueries({ queryKey: ["abort-contract"] });
    resolve("late secret-bearing response");

    await expect(request).rejects.toThrow("CancelledError");
    expect(queryClient.getQueryData(["abort-contract"])).toBeUndefined();
  });
});
