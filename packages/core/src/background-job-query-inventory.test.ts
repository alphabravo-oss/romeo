import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const servicesDirectory = new URL("./services/", import.meta.url).pathname;

describe("background-job query inventory", () => {
  it("requires bounded repository queries and exact-ID lookups in runtime code", () => {
    const violations: string[] = [];
    for (const file of runtimeTypeScriptFiles(servicesDirectory)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      walk(source, (node) => {
        if (!isBackgroundJobListCall(node)) return;
        const line =
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const query = node.arguments[1];
        if (query === undefined || !ts.isObjectLiteralExpression(query)) {
          violations.push(`${file}:${line}: missing explicit bounded query`);
          return;
        }
        const limit = query.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText(source) === "limit",
        );
        if (limit === undefined)
          violations.push(`${file}:${line}: query has no explicit limit`);
        if (
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name.text === "find"
        )
          violations.push(`${file}:${line}: exact lookup scans a list`);
      });
    }
    expect(violations).toEqual([]);
  });
});

function runtimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeTypeScriptFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function isBackgroundJobListCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "listBackgroundJobs"
  );
}
