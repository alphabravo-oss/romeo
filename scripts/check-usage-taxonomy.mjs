import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";

import {
  UsageMetricCodes,
  UsageUnitCodes,
} from "../packages/contracts/src/usage-metrics.ts";
import { USAGE_METRIC_DEFINITIONS } from "../packages/core/src/usage-taxonomy.ts";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "packages/core/src");
const requiredMetrics = [
  "llm.input_token.reported",
  "llm.cached_input_token.reported",
  "llm.reasoning_token.reported",
  "image.generated",
  "image.input",
  "audio.input_second",
  "audio.output_second",
  "video.input_second",
  "compute.cpu_millisecond",
  "compute.memory_byte_millisecond",
  "retrieval.unit",
  "storage.byte",
];
const allowedUnits = new Set(UsageUnitCodes);
const deprecatedUnits = new Set(["char", "count", "disconnect", "ms"]);
const violations = [];
const literalMetrics = new Set();
const dynamicMetricSites = new Map();
const acceptedDynamicMetricSites = new Map([
  ["packages/core/src/services/chat-feedback-service.ts", 1],
  ["packages/core/src/services/record-usage.ts", 1],
  ["packages/core/src/services/run-usage.ts", 3],
  ["packages/core/src/services/voice-service.ts", 1],
]);

for (const metric of requiredMetrics) {
  if (!Object.hasOwn(USAGE_METRIC_DEFINITIONS, metric))
    violations.push(`required metric is missing: ${metric}`);
}

const contractMetrics = new Set(UsageMetricCodes);
const registryMetrics = new Set(Object.keys(USAGE_METRIC_DEFINITIONS));
for (const metric of contractMetrics) {
  if (!registryMetrics.has(metric))
    violations.push(`public metric lacks core semantics: ${metric}`);
}
for (const metric of registryMetrics) {
  if (!contractMetrics.has(metric))
    violations.push(
      `core metric is missing from the public contract: ${metric}`,
    );
}

for (const [metric, definition] of Object.entries(USAGE_METRIC_DEFINITIONS)) {
  if (!allowedUnits.has(definition.unit))
    violations.push(`${metric} uses noncanonical unit ${definition.unit}`);
  if (deprecatedUnits.has(definition.unit))
    violations.push(`${metric} retains deprecated unit ${definition.unit}`);
  if (definition.sourceTypes.length === 0)
    violations.push(`${metric} has no source type`);
  if (new Set(definition.sourceTypes).size !== definition.sourceTypes.length)
    violations.push(`${metric} has duplicate source types`);
  if (
    definition.overlapPolicy === "component_of_total" &&
    definition.aggregation !== "sum"
  )
    violations.push(`${metric} has invalid component aggregation`);
}

for (const file of sourceFiles(sourceRoot)) inspectFile(file);

for (const metric of literalMetrics) {
  if (!Object.hasOwn(USAGE_METRIC_DEFINITIONS, metric))
    violations.push(`unregistered literal usage metric: ${metric}`);
}

for (const [path, count] of dynamicMetricSites) {
  const expected = acceptedDynamicMetricSites.get(path);
  if (expected === undefined)
    violations.push(`${path} has ${count} unreviewed dynamic metric site(s)`);
  else if (count !== expected)
    violations.push(
      `${path} has ${count} dynamic metric site(s), expected ${expected}`,
    );
}
for (const [path, expected] of acceptedDynamicMetricSites) {
  const actual = dynamicMetricSites.get(path) ?? 0;
  if (actual !== expected && !dynamicMetricSites.has(path))
    violations.push(
      `${path} has ${actual} dynamic metric site(s), expected ${expected}`,
    );
}

if (violations.length > 0) {
  console.error(`Usage taxonomy check failed:\n- ${violations.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Usage taxonomy check passed (${Object.keys(USAGE_METRIC_DEFINITIONS).length} canonical metrics; ${literalMetrics.size} production literal call-site metrics; ${[...dynamicMetricSites.values()].reduce((sum, count) => sum + count, 0)} reviewed dynamic metric sites; zero direct-write bypasses).`,
);

function inspectFile(file) {
  const path = relative(root, file);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = calledPropertyName(node.expression);
    if (
      (name === "createUsageEvent" || name === "updateUsageEvent") &&
      path !== "packages/core/src/services/record-usage.ts"
    )
      violations.push(`${path} bypasses the canonical usage writer`);
    if (name !== "recordUsage" && name !== "recordSubjectUsage") return;
    const object = node.arguments.find(ts.isObjectLiteralExpression);
    if (object === undefined) return;
    const metric = propertyInitializer(object, "metric");
    const callMetrics = new Set();
    collectLiteralStrings(metric, callMetrics);
    if (callMetrics.size === 0)
      dynamicMetricSites.set(path, (dynamicMetricSites.get(path) ?? 0) + 1);
    else for (const value of callMetrics) literalMetrics.add(value);
    const unit = propertyInitializer(object, "unit");
    const units = new Set();
    collectLiteralStrings(unit, units);
    for (const value of units) {
      if (deprecatedUnits.has(value))
        violations.push(`${path} writes deprecated usage unit ${value}`);
    }
  });
}

function propertyInitializer(object, propertyName) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    if (
      (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
      name.text === propertyName
    )
      return property.initializer;
  }
  return undefined;
}

function collectLiteralStrings(node, destination) {
  if (node === undefined) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    destination.add(node.text);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectLiteralStrings(node.whenTrue, destination);
    collectLiteralStrings(node.whenFalse, destination);
  }
}

function calledPropertyName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !path.endsWith(".ts") || path.endsWith(".test.ts"))
      return [];
    return [path];
  });
}
