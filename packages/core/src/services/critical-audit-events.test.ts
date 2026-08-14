import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { auditActionRegistry } from "../audit-taxonomy";
import {
  CRITICAL_AUDIT_ACTIONS,
  missingCriticalAuditWrites,
} from "./critical-audit-events";

describe("critical audit events", () => {
  it("registers every protected action and fails when a writer disappears", () => {
    for (const action of CRITICAL_AUDIT_ACTIONS) {
      expect(auditActionRegistry[action]?.action).toBe(action);
    }
    expect(
      missingCriticalAuditWrites(new Set(["provider.create"])),
    ).toContain("admin.organization.suspend");

    const written = collectQuotedActions(
      dirname(fileURLToPath(new URL(".", import.meta.url))),
    );
    expect(missingCriticalAuditWrites(written)).toEqual([]);
  });
});

function collectQuotedActions(root: string): Set<string> {
  const actions = new Set<string>();
  const needle = new Set<string>(CRITICAL_AUDIT_ACTIONS);
  for (const file of listProductionTs(root)) {
    const source = readFileSync(file, "utf8");
    for (const action of needle) {
      if (source.includes(`"${action}"`) || source.includes(`'${action}'`))
        actions.add(action);
    }
  }
  return actions;
}

function listProductionTs(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listProductionTs(path));
      continue;
    }
    if (
      entry.name.endsWith(".test.ts") ||
      !entry.name.endsWith(".ts") ||
      entry.name === "critical-audit-events.ts"
    )
      continue;
    files.push(path);
  }
  return files;
}
