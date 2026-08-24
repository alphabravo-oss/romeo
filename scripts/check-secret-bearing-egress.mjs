#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inventoryPath = "docs/security/secret-bearing-egress-inventory.json";
const inventory = JSON.parse(
  readFileSync(resolve(root, inventoryPath), "utf8"),
);

const requirements = new Map([
  [
    "packages/core/src/services/tool-oauth-client-credentials.ts",
    [
      "allowedUrls: [tokenUrl.toString()]",
      "[oauth.customFetch]: tokenFetch",
      "SecretBearingEgressClient",
    ],
  ],
  [
    "packages/cli/src/tool-dispatch-auth.ts",
    [
      "{ ...input, allowPrivateNetwork: false }",
      "assertResolvedHostAllowed",
      "fetchApprovedHost",
      'redirect: "error"',
    ],
  ],
  [
    "packages/core/src/services/delegated-oauth-github-provider.ts",
    [
      "githubTokenFetch(fetchImpl)",
      "githubResourceFetch(fetchImpl)",
      "SecretBearingEgressClient",
    ],
  ],
  [
    "packages/core/src/services/oauth2-pkce-service.ts",
    [
      "allowedUrls: [githubTokenEndpoint]",
      "[oauth.customFetch]: tokenFetch",
      "SecretBearingEgressClient",
    ],
  ],
  [
    "packages/core/src/services/github-oauth2-auth-provider.ts",
    [
      "allowedOrigins: [githubApiOrigin]",
      "boundedProviderFetch(resourceFetch",
      "SecretBearingEgressClient",
    ],
  ],
  [
    "packages/core/src/services/github-data-connector-executor.ts",
    [
      "allowedOrigins: [githubApiOrigin]",
      "request: { fetch: resourceFetch }",
      "SecretBearingEgressClient",
    ],
  ],
  [
    "packages/core/src/services/oidc-egress.ts",
    [
      "requestCarriesCredentials",
      "oidc_credential_redirect_blocked",
      "assertConnectorHostAllowed",
      "pinnedFetchImpl",
    ],
  ],
  [
    "packages/core/src/services/compatibility-provider-egress.ts",
    [
      "SecretBearingEgressClient",
      "allowedOrigins: [origin]",
      'responseMode: input.responseMode ?? "buffered"',
    ],
  ],
  [
    "packages/core/src/services/provider-secret-egress.ts",
    [
      "compatibilityProviderFetch",
      "hasSensitiveHeaders",
      "secret_egress_destination_blocked",
    ],
  ],
]);

const boundaryRequirements = [
  "assertConnectorHostAllowed",
  "dnsPinnedFetch",
  'redirect: "manual"',
  "secret_egress_redirect_blocked",
  "secret_egress_response_too_large",
  "secret_egress_timeout",
  "allowedOrigins",
  "allowedUrls",
];

function loadSources() {
  return new Map(
    [
      ...requirements.keys(),
      "packages/core/src/services/secret-bearing-egress.ts",
    ].map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
  );
}

function validate(sources) {
  const failures = [];
  if (inventory.schema !== "romeo.secret-bearing-egress-inventory.v1")
    failures.push(`${inventoryPath}: unsupported or missing schema`);
  const inventoriedSources = new Set(
    Array.isArray(inventory.surfaces)
      ? inventory.surfaces.map((surface) => surface.source)
      : [],
  );
  for (const [path, expected] of requirements) {
    const source = sources.get(path) ?? "";
    if (!inventoriedSources.has(path))
      failures.push(`${path}: hardened consumer is absent from inventory`);
    for (const marker of expected) {
      if (!source.includes(marker))
        failures.push(`${path}: missing hardened boundary marker ${marker}`);
    }
  }
  const boundary = sources.get(
    "packages/core/src/services/secret-bearing-egress.ts",
  );
  for (const marker of boundaryRequirements) {
    if (!boundary?.includes(marker))
      failures.push(`secret-bearing boundary: missing invariant ${marker}`);
  }
  return failures;
}

const sources = loadSources();
if (process.argv.includes("--self-test")) {
  const cases = [];
  for (const [path, [marker]] of requirements) {
    const mutated = new Map(sources);
    mutated.set(path, (mutated.get(path) ?? "").replaceAll(marker, "REMOVED"));
    cases.push({ id: `consumer:${path}`, failures: validate(mutated) });
  }
  for (const marker of boundaryRequirements) {
    const mutated = new Map(sources);
    const path = "packages/core/src/services/secret-bearing-egress.ts";
    mutated.set(path, (mutated.get(path) ?? "").replaceAll(marker, "REMOVED"));
    cases.push({ id: `boundary:${marker}`, failures: validate(mutated) });
  }
  const missed = cases.filter((item) => item.failures.length === 0);
  if (missed.length > 0) {
    console.error(
      `secret-bearing egress self-test failed to detect: ${missed.map((item) => item.id).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `secret-bearing egress self-test: ${cases.length} negative mutations rejected`,
  );
  process.exit(0);
}

const failures = validate(sources);
if (failures.length > 0) {
  console.error("Secret-bearing egress policy failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `secret-bearing egress: ${requirements.size} inventoried consumers and ${boundaryRequirements.length} boundary invariants verified`,
);
