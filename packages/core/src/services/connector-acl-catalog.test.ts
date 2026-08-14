import { describe, expect, it } from "vitest";

import {
  declareConnectorAclCapability,
  explainKnowledgeAccess,
  mapExternalPrincipal,
} from "./connector-acl-catalog";

describe("connector ACL catalog and explanations", () => {
  it("forbids fail-open ACL connectors and requires an immutable principal id", () => {
    expect(
      declareConnectorAclCapability({
        connectorId: "sharepoint",
        documentAcl: true,
        userAcl: true,
        groupAcl: true,
        delegatedQuery: true,
        freshness: "synchronized",
        deletion: "tombstone",
        failBehavior: "fail_open",
      }),
    ).toEqual({
      outcome: "denied",
      code: "connector_acl_fail_open_forbidden",
    });
    expect(
      mapExternalPrincipal({ displayName: "Ada", email: "ada@example.test" }),
    ).toEqual({ outcome: "unresolved", code: "principal_id_required" });
    expect(mapExternalPrincipal({ externalId: "oid-ada" })).toEqual({
      outcome: "mapped",
      principalKind: "immutable_id",
      principalId: "oid-ada",
    });
  });

  it("explains access with versions and without titles or principals", () => {
    const explanation = explainKnowledgeAccess({
      allowed: true,
      aclRevision: "acl:9",
      grantVersion: "grant:3",
      principalId: "user_secret",
      documentTitle: "Privileged memo",
    });
    expect(explanation).toEqual({
      audience: "user",
      allowed: true,
      aclRevision: "acl:9",
      grantVersion: "grant:3",
    });
    expect(JSON.stringify(explanation)).not.toContain("user_secret");
    expect(JSON.stringify(explanation)).not.toContain("Privileged");
  });
});
