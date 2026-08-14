#!/usr/bin/env node
// packages/core and packages/cli each carry their own dnsPinnedFetch. The
// duplication is deliberate: the CLI does not depend on @romeo/core, and
// pulling db/storage/auth/providers in for one function is not worth it.
//
// What is NOT acceptable is the two copies drifting. Both are SSRF controls,
// so a fix applied to one and not the other silently leaves the other path on
// the old behaviour. This asserts the security-relevant invariants are present
// and identical in both, while tolerating the cosmetic differences that
// legitimately exist (type names, doc comments, the CLI's address narrowing).
//
// Run: node scripts/check-dns-pinning-parity.mjs   (also `pnpm check:dns-pinning-parity`)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const copies = [
  { label: "core", path: "packages/core/src/services/dns-pinned-fetch.ts" },
  { label: "cli", path: "packages/cli/src/dns-pinned-fetch.ts" },
];

/**
 * Each invariant is a security-relevant behaviour, not a formatting detail.
 * `extract` returns a comparable value; a missing or differing value in either
 * copy is a drift failure.
 */
const invariants = [
  {
    id: "bodyless_statuses",
    why: "Statuses that must not carry a response body.",
    extract: (source) =>
      source.match(/\[\s*101\s*,\s*204\s*,\s*205\s*,\s*304\s*\]/u)?.[0],
  },
  {
    id: "empty_address_guard",
    why: "Refuses to connect when the policy approved no address.",
    extract: (source) =>
      /addresses\.length === 0|approved\.length === 0/u.test(source)
        ? "guarded"
        : undefined,
  },
  {
    id: "family_mismatch_enotfound",
    why: "Unmatched address family fails lookup instead of falling back to DNS.",
    extract: (source) =>
      source.includes('code: "ENOTFOUND"') ? "enotfound" : undefined,
  },
  {
    id: "lookup_all_contract",
    why: "Honours the all:true callback shape Node uses for multi-address lookups.",
    extract: (source) =>
      /\.all === true/u.test(source) ? "all_true" : undefined,
  },
  {
    id: "content_length",
    why: "Derives content-length from the buffered body when absent.",
    extract: (source) =>
      /headers\["content-length"\]\s*=\s*String\(body\.byteLength\)/u.test(
        source,
      )
        ? "derived"
        : undefined,
  },
  {
    id: "tls_scheme_switch",
    why: "Chooses the https agent by URL protocol, keeping SNI on the real host.",
    extract: (source) =>
      /url\.protocol === "https:"/u.test(source) ? "by_protocol" : undefined,
  },
  {
    id: "buffered_body_types",
    why: "Accepts exactly the body shapes that can be safely buffered.",
    extract: (source) => {
      const accepted = [
        'typeof body === "string"',
        "body instanceof URLSearchParams",
        "body instanceof ArrayBuffer",
        "ArrayBuffer.isView(body)",
      ].filter((probe) => source.includes(probe));
      return accepted.length === 4 ? accepted.join("|") : undefined;
    },
  },
  {
    id: "streaming_body_rejected",
    why: "A non-bufferable body throws rather than silently bypassing pinning.",
    extract: (source) =>
      /require a buffered request body/u.test(source) ? "throws" : undefined,
  },
];

const sources = copies.map((copy) => ({
  ...copy,
  source: readFileSync(resolve(root, copy.path), "utf8"),
}));

const failures = [];
for (const invariant of invariants) {
  const observed = sources.map((entry) => ({
    label: entry.label,
    path: entry.path,
    value: invariant.extract(entry.source),
  }));
  const missing = observed.filter((entry) => entry.value === undefined);
  if (missing.length > 0) {
    failures.push(
      `${invariant.id}: missing in ${missing.map((entry) => entry.path).join(", ")}\n    ${invariant.why}`,
    );
    continue;
  }
  const [first, ...rest] = observed;
  const drifted = rest.filter((entry) => entry.value !== first.value);
  if (drifted.length > 0) {
    failures.push(
      `${invariant.id}: differs between copies\n    ${invariant.why}\n` +
        observed
          .map((entry) => `      ${entry.label}: ${String(entry.value)}`)
          .join("\n"),
    );
  }
}

if (failures.length > 0) {
  console.error("DNS pinning parity check failed:\n");
  for (const failure of failures) console.error(`  - ${failure}\n`);
  console.error(
    `Both copies implement the same SSRF control:\n${copies
      .map((copy) => `  ${copy.path}`)
      .join("\n")}\nApply the change to both, or collapse them into one module.`,
  );
  process.exit(1);
}

console.log(
  `dns pinning parity: ${invariants.length} invariants match across ${copies.length} copies`,
);
