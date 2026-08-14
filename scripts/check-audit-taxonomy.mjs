import { relative, resolve } from "node:path";

import ts from "typescript";

import { auditActionsByCategory } from "../packages/core/src/audit-action-inventory.ts";
import { auditActionRegistry } from "../packages/core/src/audit-taxonomy.ts";
import { CRITICAL_AUDIT_ACTIONS } from "../packages/core/src/services/critical-audit-events.ts";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "packages/core/src");
const acceptedDirectWriteLimits = {};
const acceptedDynamicActionLimits = {};
const acceptedDynamicMetadataLimits = {};
const configPath = resolve(root, "packages/core/tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error !== undefined)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
  );
const parsedConfig = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  resolve(root, "packages/core"),
);
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();
const directWrites = new Map();
const dynamicActions = new Map();
const dynamicMetadata = new Map();
const violations = [];

for (const source of program.getSourceFiles()) {
  if (
    source.fileName.startsWith(sourceRoot) &&
    !source.fileName.endsWith(".test.ts") &&
    !source.fileName.endsWith(".d.ts")
  )
    inspectFile(source);
}
const allocatedActions = Object.values(auditActionsByCategory).flat();
if (new Set(allocatedActions).size !== allocatedActions.length)
  violations.push("action inventory contains a duplicate allocation");
if (Object.keys(auditActionRegistry).length !== allocatedActions.length)
  violations.push("runtime registry does not preserve every action allocation");
for (const [action, definition] of Object.entries(auditActionRegistry)) {
  if (definition.action !== action)
    violations.push(`${action} has mismatched runtime action metadata`);
  const keys = Object.keys(definition.allowedMetadata);
  if (new Set(keys).size !== keys.length)
    violations.push(`${action} has duplicate metadata-key allocations`);
}
assertWithinBaseline(
  "direct createAuditLog bypass",
  directWrites,
  acceptedDirectWriteLimits,
);
assertWithinBaseline(
  "dynamic canonical action",
  dynamicActions,
  acceptedDynamicActionLimits,
);
assertWithinBaseline(
  "dynamic canonical metadata",
  dynamicMetadata,
  acceptedDynamicMetadataLimits,
);

const writtenCritical = new Set();
for (const source of program.getSourceFiles()) {
  if (
    !source.fileName.startsWith(sourceRoot) ||
    source.fileName.endsWith(".test.ts") ||
    source.fileName.endsWith(".d.ts") ||
    source.fileName.endsWith("critical-audit-events.ts")
  )
    continue;
  const text = source.getFullText();
  for (const action of CRITICAL_AUDIT_ACTIONS) {
    if (text.includes(`"${action}"`) || text.includes(`'${action}'`))
      writtenCritical.add(action);
  }
}
for (const action of CRITICAL_AUDIT_ACTIONS) {
  if (!writtenCritical.has(action))
    violations.push(`critical action ${action} has no production write site`);
}

if (violations.length > 0) {
  console.error(`Audit taxonomy check failed:\n- ${violations.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Audit taxonomy check passed (${Object.keys(auditActionRegistry).length} actions; ${sum(directWrites)} direct-write bypasses; ${sum(dynamicActions)} dynamic actions; ${sum(dynamicMetadata)} dynamic metadata sites).`,
);

function inspectFile(source) {
  const path = relative(root, source.fileName);
  visit(source);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const calledName = callName(node.expression);
      if (
        calledName === "createAuditLog" &&
        path !== "packages/core/src/services/audit-log.ts"
      )
        increment(directWrites, path);
      if (calledName === "writeAuditLog")
        inspectCanonicalCall(node, source, path);
    }
    ts.forEachChild(node, visit);
  }
}

function inspectCanonicalCall(call, source, path) {
  const input = call.arguments[1];
  if (input === undefined || !ts.isObjectLiteralExpression(input)) {
    increment(dynamicActions, path);
    return;
  }
  const actionNode = propertyValue(input, "action");
  const actions =
    actionNode === undefined ? undefined : finiteStringValues(actionNode);
  if (actions === undefined || actions.size === 0) {
    increment(dynamicActions, path);
    return;
  }
  for (const action of actions) {
    if (auditActionRegistry[action] === undefined)
      violations.push(
        `${location(source, actionNode, path)} uses unregistered action ${action}`,
      );
  }
  const metadataNode = propertyValue(input, "metadata");
  if (metadataNode === undefined) return;
  const metadataType = checker.getTypeAtLocation(metadataNode);
  if (checker.getIndexTypeOfType(metadataType, ts.IndexKind.String)) {
    increment(dynamicMetadata, path);
    return;
  }
  for (const property of checker.getPropertiesOfType(metadataType)) {
    const key = property.getName();
    if (
      ![...actions].some(
        (action) =>
          auditActionRegistry[action]?.allowedMetadata[key] !== undefined,
      )
    )
      violations.push(
        `${location(source, metadataNode, path)} uses metadata key ${key} outside its finite action set`,
      );
  }
}

function finiteStringValues(node) {
  return finiteStringTypeValues(checker.getTypeAtLocation(node), new Set());
}

function finiteStringTypeValues(type, seen) {
  if (seen.has(type)) return new Set();
  seen.add(type);
  if (type.isStringLiteral()) return new Set([type.value]);
  if (type.isUnion()) {
    const result = new Set();
    for (const member of type.types) {
      const values = finiteStringTypeValues(member, seen);
      if (values === undefined) return undefined;
      for (const value of values) result.add(value);
    }
    return result;
  }
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint === undefined
      ? undefined
      : finiteStringTypeValues(constraint, seen);
  }
  return undefined;
}

function assertWithinBaseline(label, actual, baseline) {
  for (const [path, count] of actual) {
    const limit = baseline[path] ?? 0;
    if (count > limit)
      violations.push(
        `${path} has ${count} ${label} sites (baseline ${limit})`,
      );
  }
  for (const [path, limit] of Object.entries(baseline)) {
    const count = actual.get(path) ?? 0;
    if (count > limit)
      violations.push(
        `${path} has ${count} ${label} sites (baseline ${limit})`,
      );
  }
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function propertyValue(object, name) {
  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    )
      continue;
    if (propertyName(property.name) !== name) continue;
    return ts.isShorthandPropertyAssignment(property)
      ? property.name
      : property.initializer;
  }
  return undefined;
}

function propertyName(name) {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function location(source, node, path) {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${path}:${line + 1}`;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sum(map) {
  return [...map.values()].reduce((total, count) => total + count, 0);
}
