import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "apps/app/src");
const evidencePath = resolve(root, "dist/ci/ui-form-contracts.json");
const controlNames = new Set(["Input", "NativeSelect", "Select", "Textarea"]);
const excludedFilePattern = /(?:\.test|\.spec|\.stories)\.tsx$/u;
const findings = [];
let formCount = 0;
let controlCount = 0;

for (const file of await collectFiles(sourceRoot)) {
  const sourceText = await readFile(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  visit(source, source);
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: findings.length === 0 ? "passed" : "failed",
  scope: "apps/app/src/**/*.tsx excluding tests, stories, and specifications",
  checks: [
    "named controls inside native forms",
    "accessible labels for controls inside native forms",
    "explicit autocomplete intent for identity and credential controls",
  ],
  counts: {
    controls: controlCount,
    findings: findings.length,
    forms: formCount,
  },
  findings,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} ${finding.rule}: ${finding.message}`,
    );
  }
  throw new Error(
    `UI form contract failed with ${findings.length} finding(s). Evidence: ${relative(root, evidencePath)}`,
  );
}

console.log(
  `UI form contract passed for ${formCount} forms and ${controlCount} controls.`,
);
console.log(`Wrote UI form evidence to ${evidencePath}`);

function visit(node, source) {
  if (isElementNamed(node, "form")) formCount += 1;
  if (isControl(node) && closestForm(node)) {
    controlCount += 1;
    const attributes = controlOpening(node).attributes;
    const type = stringAttribute(attributes, "type")?.toLowerCase();
    if (type !== "hidden" && !hasAttribute(attributes, "name")) {
      addFinding(source, node, "control-name", "form control has no name");
    }
    if (type !== "hidden" && !hasAccessibleLabel(node)) {
      addFinding(
        source,
        node,
        "control-label",
        "form control is not wrapped by Field and has no aria-label or aria-labelledby",
      );
    }
    if (
      requiresAutocomplete(attributes) &&
      !hasAttribute(attributes, "autoComplete")
    ) {
      addFinding(
        source,
        node,
        "control-autocomplete",
        "identity or credential control has no explicit autoComplete value",
      );
    }
  }
  ts.forEachChild(node, (child) => visit(child, source));
}

function isControl(node) {
  return (
    (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
    controlNames.has(controlOpening(node).tagName.getText())
  );
}

function controlOpening(node) {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function isElementNamed(node, name) {
  return (
    ts.isJsxElement(node) && node.openingElement.tagName.getText() === name
  );
}

function closestForm(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isElementNamed(current, "form")) return current;
  }
  return undefined;
}

function hasAccessibleLabel(node) {
  const attributes = controlOpening(node).attributes;
  if (
    hasAttribute(attributes, "aria-label") ||
    hasAttribute(attributes, "aria-labelledby")
  ) {
    return true;
  }
  for (let current = node.parent; current; current = current.parent) {
    if (isElementNamed(current, "form")) break;
    if (isElementNamed(current, "Field") || isElementNamed(current, "label")) {
      return true;
    }
  }
  const id = stringAttribute(attributes, "id");
  const form = closestForm(node);
  if (id && form && containsAssociatedLabel(form, id)) return true;
  return false;
}

function containsAssociatedLabel(node, id) {
  if (
    isElementNamed(node, "label") &&
    stringAttribute(node.openingElement.attributes, "htmlFor") === id
  ) {
    return true;
  }
  return node.getChildren().some((child) => containsAssociatedLabel(child, id));
}

function requiresAutocomplete(attributes) {
  const type = stringAttribute(attributes, "type")?.toLowerCase();
  const name = stringAttribute(attributes, "name")?.toLowerCase() ?? "";
  return (
    type === "email" ||
    type === "password" ||
    /^(?:email|emailaddress|password|currentpassword|newpassword|username|one-time-code|otp)$/u.test(
      name,
    )
  );
}

function hasAttribute(attributes, name) {
  return attributes.properties.some(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name,
  );
}

function stringAttribute(attributes, name) {
  const attribute = attributes.properties.find(
    (candidate) => ts.isJsxAttribute(candidate) && candidate.name.text === name,
  );
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) {
    return undefined;
  }
  if (ts.isStringLiteral(attribute.initializer))
    return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteralLike(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  return undefined;
}

function addFinding(source, node, rule, message) {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  findings.push({
    column: position.character + 1,
    file: relative(root, source.fileName),
    line: position.line + 1,
    message,
    rule,
  });
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (
      extname(entry.name) === ".tsx" &&
      !excludedFilePattern.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files.sort();
}
