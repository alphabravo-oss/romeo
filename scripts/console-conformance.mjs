/**
 * CI gate for console design conformance.
 *
 * Runs the audit over every admin and workspace route and fails on the classes
 * of defect that have already been driven to zero, so they cannot come back.
 * Kinds still above zero (legacy-class, adhoc-margin, …) are reported but not
 * gated; move a kind into GATED as its count reaches zero.
 *
 * Needs a running app: ROMEO_BASE_URL, default http://localhost:30000.
 */
import { spawnSync } from "node:child_process";

const GATED = [
  "duplicate-title",
  "clipped-descender",
  "bare-table",
  "legacy-empty",
];

const ADMIN = [
  "overview",
  "providers",
  "rag",
  "chat-experience",
  "prompt-templates",
  "web-search",
  "users",
  "groups",
  "workspace-members",
  "organizations",
  "auth-providers",
  "impersonation",
  "access",
  "usage",
  "analytics",
  "audit",
  "posture",
  "governance",
  "abuse",
  "billing",
  "connections",
  "workflows",
  "webhooks",
  "notification-channels",
  "connected-apps",
];
const ADMIN_VIEWS = [
  ["providers", "base-models"],
  ["providers", "curated"],
  ["providers", "observability"],
  ["usage", "quotas"],
  ["access", "service-accounts"],
  ["connections", "imports"],
  ["connections", "catalog"],
  ["connections", "tools"],
];
const WORKSPACE = [
  "agents",
  "knowledge",
  "tools",
  "voice",
  "evals",
  "collaboration",
];
const AGENT_TABS = [
  "behavior",
  "capabilities",
  "knowledge",
  "tools",
  "voice",
  "access",
  "versions",
];

const routes = [
  ...ADMIN.map((s) => (s === "overview" ? "/admin" : `/admin?section=${s}`)),
  ...ADMIN_VIEWS.map(([s, v]) => `/admin?section=${s}&view=${v}`),
  ...WORKSPACE.map((s) => `/workspace?section=${s}`),
  ...AGENT_TABS.map((t) => `/workspace?section=agents&tab=${t}`),
];

const result = spawnSync(
  process.execPath,
  ["scripts/console-audit.mjs", `--fail-on=${GATED.join(",")}`, ...routes],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(process.env.ROMEO_BASE_URL
        ? { BASE: process.env.ROMEO_BASE_URL }
        : {}),
    },
  },
);
process.exit(result.status ?? 1);
