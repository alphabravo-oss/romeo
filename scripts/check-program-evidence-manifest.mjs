import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(
    resolve(root, "docs/release/evidence-requirements.json"),
    "utf8",
  ),
);
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const checklistSource = readFileSync(
  resolve(root, "scripts/generate-ga-checklist.mjs"),
  "utf8",
);
const errors = validate(manifest, packageJson.scripts ?? {}, checklistSource);
errors.push(...selfTest(manifest, packageJson.scripts ?? {}, checklistSource));

if (errors.length > 0) {
  console.error(
    `Program evidence manifest failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `Program evidence manifest passed (${manifest.categories.length} categories).`,
);

function validate(value, scripts, checklist) {
  const findings = [];
  if (value?.schemaVersion !== "romeo.program-evidence-requirements.v1")
    findings.push("unsupported schemaVersion");
  const categories = Array.isArray(value?.categories) ? value.categories : [];
  const expected = [
    "browser_matrix",
    "capability_posture",
    "load_results",
    "migration_level",
    "provider_probes",
    "rollback_rehearsal",
    "security_scans",
  ];
  const ids = categories.map((category) => category?.id).sort();
  if (ids.join("\n") !== expected.join("\n"))
    findings.push("required evidence categories differ");
  if (new Set(ids).size !== ids.length)
    findings.push("evidence category IDs must be unique");

  for (const category of categories) {
    const prefix = typeof category?.id === "string" ? category.id : "unknown";
    if (!Array.isArray(category?.commands) || category.commands.length === 0)
      findings.push(`${prefix}: commands must be non-empty`);
    for (const command of category?.commands ?? []) {
      if (typeof scripts[command] !== "string")
        findings.push(`${prefix}: unknown package command ${String(command)}`);
    }
    if (!Array.isArray(category?.gateIds))
      findings.push(`${prefix}: gateIds must be an array`);
    for (const gateId of category?.gateIds ?? []) {
      if (typeof gateId !== "string" || !checklist.includes(`id: "${gateId}"`))
        findings.push(`${prefix}: unknown GA gate ${String(gateId)}`);
    }
    if (!Array.isArray(category?.evidence) || category.evidence.length === 0)
      findings.push(`${prefix}: evidence must be non-empty`);
    const paths = new Set();
    for (const evidence of category?.evidence ?? []) {
      if (
        typeof evidence?.path !== "string" ||
        (!evidence.path.startsWith("dist/") &&
          !evidence.path.startsWith("docs/database/")) ||
        evidence.path.includes("..")
      ) {
        findings.push(`${prefix}: unsafe evidence path`);
      }
      if (paths.has(evidence?.path))
        findings.push(`${prefix}: duplicate evidence path`);
      paths.add(evidence?.path);
      if (
        (typeof evidence?.schemaVersion !== "string" &&
          typeof evidence?.schemaVersion !== "number") ||
        String(evidence.schemaVersion).length === 0
      ) {
        findings.push(`${prefix}: evidence schemaVersion is required`);
      }
    }
  }
  if (
    value?.privacy?.evidenceBodiesIncluded !== false ||
    value?.privacy?.rawContentAllowed !== false ||
    value?.privacy?.secretValuesAllowed !== false
  ) {
    findings.push("privacy posture must exclude bodies, content, and secrets");
  }
  return findings;
}

function selfTest(value, scripts, checklist) {
  const cloned = () => structuredClone(value);
  const cases = [];
  const missingCategory = cloned();
  missingCategory.categories.pop();
  cases.push([
    "missing category",
    validate(missingCategory, scripts, checklist).some((item) =>
      item.includes("categories differ"),
    ),
  ]);
  const unknownCommand = cloned();
  unknownCommand.categories[0].commands = ["not:a:command"];
  cases.push([
    "unknown command",
    validate(unknownCommand, scripts, checklist).some((item) =>
      item.includes("unknown package command"),
    ),
  ]);
  const unsafePath = cloned();
  unsafePath.categories[0].evidence[0].path = "../secret.env";
  cases.push([
    "unsafe path",
    validate(unsafePath, scripts, checklist).some((item) =>
      item.includes("unsafe evidence path"),
    ),
  ]);
  const contentLeak = cloned();
  contentLeak.privacy.rawContentAllowed = true;
  cases.push([
    "content leak posture",
    validate(contentLeak, scripts, checklist).some((item) =>
      item.includes("privacy posture"),
    ),
  ]);
  return cases.flatMap(([name, passed]) =>
    passed ? [] : [`manifest self-test failed: ${name}`],
  );
}
