import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";

import ts from "typescript";

import {
  publicApiErrorDefinition,
  publicApiErrorRegistry,
  publicErrorCodesByHttpStatus,
} from "../packages/core/src/public-api-error-registry.ts";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "packages/core/src");
const failures = [];
const observedLiteralCodes = new Set();

validateRegistry();
validateLocalizationCatalogs();
scanApiErrors();
validateDirectEnvelopeCodes();
runSelfTest();

if (failures.length > 0) {
  console.error(
    `Public API error policy failed:\n${failures.map((item) => `- ${item}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Public API error policy passed (${Object.keys(publicApiErrorRegistry).length} registered codes, ${observedLiteralCodes.size} literal ApiError codes).`,
  );
}

function validateRegistry() {
  const approvedMultiStatus = new Map([
    ["delegated_oauth_scope_invalid", [400, 401]],
    ["knowledge_retrieval_plan_empty", [400, 403]],
    ["managed_secret_external_write_failed", [502, 400, 403, 409]],
    ["saml_request_state_invalid", [400, 401]],
    ["scim_error", [400, 403, 404, 409]],
  ]);
  for (const code of duplicateRegistryCodes(publicErrorCodesByHttpStatus))
    failures.push(`${code}: duplicate registry entry.`);
  for (const [rawStatus, codes] of Object.entries(
    publicErrorCodesByHttpStatus,
  )) {
    const status = Number(rawStatus);
    for (const code of codes) {
      const definition = publicApiErrorDefinition(code);
      if (definition === undefined) {
        failures.push(`${code}: registry definition is missing.`);
        continue;
      }
      if (definition.httpStatus !== status)
        failures.push(
          `${code}: canonical HTTP status does not match inventory.`,
        );
      if (
        definition.copyKey !==
        `api-errors:intents.${definition.localizationIntent}`
      )
        failures.push(`${code}: localization copy key does not match intent.`);
      if (!/^[a-z][a-z0-9_]{1,119}$/u.test(code))
        failures.push(
          `${code}: public code is not a bounded stable identifier.`,
        );
      if (definition.acceptedHttpStatuses[0] !== definition.httpStatus)
        failures.push(`${code}: canonical status must be first.`);
      if (
        new Set(definition.acceptedHttpStatuses).size !==
        definition.acceptedHttpStatuses.length
      )
        failures.push(`${code}: duplicate accepted HTTP status.`);
      if (definition.acceptedHttpStatuses.length > 1) {
        const approved = approvedMultiStatus.get(code);
        if (
          approved === undefined ||
          approved.join(",") !== definition.acceptedHttpStatuses.join(",")
        )
          failures.push(`${code}: unapproved multi-status compatibility debt.`);
        approvedMultiStatus.delete(code);
      }
    }
  }
  for (const code of approvedMultiStatus.keys())
    failures.push(`${code}: approved multi-status allocation is missing.`);
}

function validateLocalizationCatalogs() {
  const byLocale = Object.fromEntries(
    ["en", "es", "fr"].map((locale) => [
      locale,
      JSON.parse(
        readFileSync(
          resolve(root, `apps/app/src/locales/${locale}/api-errors.json`),
          "utf8",
        ),
      ),
    ]),
  );
  const expectedKeys = [
    ...new Set(
      Object.values(publicApiErrorRegistry).map((definition) =>
        definition.copyKey.replace(/^api-errors:/u, ""),
      ),
    ),
  ].sort();
  for (const [locale, catalog] of Object.entries(byLocale)) {
    const actualKeys = Object.keys(catalog).sort();
    if (actualKeys.join(",") !== expectedKeys.join(","))
      failures.push(`${locale}/api-errors: localization key parity mismatch.`);
    for (const key of actualKeys)
      if (typeof catalog[key] !== "string" || catalog[key].trim().length === 0)
        failures.push(`${locale}/api-errors/${key}: translation is empty.`);
  }
}

function scanApiErrors() {
  for (const file of productionTypeScriptFiles(sourceRoot)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    visit(source, (node) => {
      if (
        !ts.isNewExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== "ApiError"
      )
        return;
      const codeNode = node.arguments?.[0];
      if (codeNode === undefined || !ts.isStringLiteralLike(codeNode)) return;
      const code = codeNode.text;
      observedLiteralCodes.add(code);
      const line =
        source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const label = `${relative(root, file)}:${line}`;
      const definition = publicApiErrorDefinition(code);
      if (definition === undefined) {
        failures.push(`${label}: unregistered ApiError code ${code}.`);
        return;
      }
      const statusNode = node.arguments?.[2];
      const status =
        statusNode === undefined
          ? 400
          : ts.isNumericLiteral(statusNode)
            ? Number(statusNode.text)
            : undefined;
      if (
        status !== undefined &&
        !definition.acceptedHttpStatuses.includes(status)
      )
        failures.push(
          `${label}: ${code} is not registered for HTTP ${status}.`,
        );
    });
  }
}

function validateDirectEnvelopeCodes() {
  const directCodes = {
    forbidden: 403,
    internal_error: 500,
    invalid_request: 400,
    request_body_too_large: 413,
    unauthorized: 401,
  };
  for (const [code, status] of Object.entries(directCodes)) {
    const definition = publicApiErrorDefinition(code);
    if (definition?.acceptedHttpStatuses.includes(status) !== true)
      failures.push(`${code}: direct public envelope code/status is missing.`);
  }
}

function runSelfTest() {
  const duplicateProbe = duplicateRegistryCodes({
    400: ["duplicate_sentinel"],
    409: ["duplicate_sentinel"],
  });
  if (duplicateProbe.join(",") !== "duplicate_sentinel")
    throw new Error("Public error duplicate self-test failed.");
  const missing = publicApiErrorDefinition("raw_secret_unregistered_sentinel");
  if (missing !== undefined)
    throw new Error("Public error unknown-code self-test failed.");
}

function duplicateRegistryCodes(groups) {
  const seen = new Set();
  const duplicates = new Set();
  for (const codes of Object.values(groups))
    for (const code of codes) {
      if (seen.has(code)) duplicates.add(code);
      seen.add(code);
    }
  return [...duplicates].sort();
}

function productionTypeScriptFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const metadata = statSync(path);
    if (metadata.isDirectory()) files.push(...productionTypeScriptFiles(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts"))
      files.push(path);
  }
  return files;
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
