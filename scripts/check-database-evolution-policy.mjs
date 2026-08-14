import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationsDirectory = resolve(root, "packages/db/migrations");
const ledgerPath = resolve(root, "docs/database/migration-ledger.json");
const journalPath = resolve(migrationsDirectory, "meta/_journal.json");

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const files = readdirSync(migrationsDirectory)
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
  .sort();
const contents = new Map(
  files.map((file) => [
    file,
    readFileSync(resolve(migrationsDirectory, file), "utf8"),
  ]),
);

const errors = validate({ contents, files, journal, ledger });
errors.push(...selfTest());
if (errors.length > 0) {
  console.error(
    "Database evolution policy failed:\n" +
      errors.map((error) => `- ${error}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  `Database evolution policy passed (${files.length} immutable migrations, ${ledger.migrations.length} strict entries).`,
);

function validate(input) {
  const findings = [];
  if (input.ledger.schemaVersion !== 1)
    findings.push("unsupported ledger schemaVersion");
  if (!Number.isInteger(input.ledger.strictPolicyStartsAt))
    findings.push("strictPolicyStartsAt must be an integer");
  if (
    !Array.isArray(input.ledger.requiredEvidence) ||
    input.ledger.requiredEvidence.length === 0
  )
    findings.push("requiredEvidence must be non-empty");

  const baseline = Array.isArray(input.ledger.lockedBaseline)
    ? input.ledger.lockedBaseline
    : [];
  const strict = Array.isArray(input.ledger.migrations)
    ? input.ledger.migrations
    : [];
  if (baseline.length > 0 && input.files[0] !== "0000_greenfield_baseline.sql")
    findings.push(
      "migration inventory must begin with 0000_greenfield_baseline.sql",
    );
  const inventory = new Map();
  for (const entry of baseline) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      typeof entry[0] !== "string" ||
      !isSha256(entry[1]) ||
      !isPhase(entry[2])
    ) {
      findings.push("invalid locked baseline entry");
      continue;
    }
    addInventory(
      inventory,
      entry[0],
      { file: entry[0], phase: entry[2], sha256: entry[1] },
      findings,
    );
  }
  for (const entry of strict) {
    if (!isRecord(entry) || typeof entry.file !== "string") {
      findings.push("invalid strict migration entry");
      continue;
    }
    validateStrictEntry(entry, input.ledger.requiredEvidence, findings);
    addInventory(inventory, entry.file, entry, findings);
  }

  if (input.files.join("\n") !== [...input.files].sort().join("\n"))
    findings.push("migration filenames are not sorted");
  const firstMigrationNumber = Number(input.files[0]?.slice(0, 4) ?? 0);
  input.files.forEach((file, index) => {
    const expectedPrefix = String(firstMigrationNumber + index).padStart(
      4,
      "0",
    );
    if (!file.startsWith(`${expectedPrefix}_`))
      findings.push(
        `${file} is not the contiguous migration at index ${index}`,
      );
    const entry = inventory.get(file);
    if (entry === undefined) {
      findings.push(`${file} is missing from the migration ledger`);
      return;
    }
    const content = input.contents.get(file) ?? "";
    if (sha256(content) !== entry.sha256)
      findings.push(`${file} digest changed`);
    const migrationNumber = Number(file.slice(0, 4));
    if (
      migrationNumber >= input.ledger.strictPolicyStartsAt &&
      !strict.includes(entry)
    )
      findings.push(`${file} must use a full strict migration entry`);
    if (migrationNumber >= input.ledger.strictPolicyStartsAt)
      validateSqlPolicy(file, content, entry, findings);
  });
  for (const file of inventory.keys()) {
    if (!input.contents.has(file))
      findings.push(`${file} is in the ledger but missing on disk`);
  }

  const journalTags = Array.isArray(input.journal.entries)
    ? input.journal.entries.map((entry) => `${entry.tag}.sql`)
    : [];
  if (journalTags.join("\n") !== input.files.join("\n"))
    findings.push("Drizzle journal and SQL migration inventory differ");
  return findings;
}

function validateStrictEntry(entry, requiredEvidence, findings) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/u.test(entry.file))
    findings.push(`${entry.file}: invalid filename`);
  if (!isSha256(entry.sha256)) findings.push(`${entry.file}: invalid SHA-256`);
  if (!isPhase(entry.phase) || entry.phase === "baseline")
    findings.push(`${entry.file}: invalid strict phase`);
  for (const field of [
    "changesExistingData",
    "restartSafe",
    "previousVersionCompatible",
    "tenantPurgeValidated",
    "backupRestoreValidated",
  ]) {
    if (typeof entry[field] !== "boolean")
      findings.push(`${entry.file}: ${field} must be boolean`);
  }
  if (entry.restartSafe !== true)
    findings.push(`${entry.file}: migration must be restart-safe`);
  if (entry.phase !== "contract" && entry.previousVersionCompatible !== true)
    findings.push(
      `${entry.file}: expand/backfill must support the previous application version`,
    );
  if (!isNonEmptyString(entry.repairStrategy))
    findings.push(`${entry.file}: repairStrategy is required`);
  if (!isRecord(entry.evidence)) {
    findings.push(`${entry.file}: evidence must be an object`);
  } else {
    for (const key of requiredEvidence) {
      if (!isSafeEvidencePath(entry.evidence[key]))
        findings.push(`${entry.file}: evidence.${key} is required`);
    }
  }
  if (
    entry.phase === "contract" &&
    !isNonEmptyString(entry.destructiveApproval)
  )
    findings.push(
      `${entry.file}: contract migration requires destructiveApproval`,
    );
}

function validateSqlPolicy(file, sql, entry, findings) {
  const normalized = stripComments(sql);
  const destructive =
    /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE\s+TABLE|ALTER\s+TABLE[\s\S]*?DROP\s+COLUMN|DELETE\s+FROM)\b/iu.test(
      normalized,
    );
  const mutatesRows =
    /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO[\s\S]*?SELECT)\b/iu.test(
      normalized,
    );
  const riskyConstraint =
    /\bALTER\s+TABLE[\s\S]*?(?:SET\s+NOT\s+NULL|ALTER\s+COLUMN[\s\S]*?TYPE)\b/iu.test(
      normalized,
    );
  if ((destructive || riskyConstraint) && entry.phase !== "contract")
    findings.push(`${file}: destructive SQL requires a contract phase`);
  if (mutatesRows && entry.changesExistingData !== true)
    findings.push(`${file}: row mutation must declare changesExistingData`);
  if (entry.phase === "backfill" && entry.changesExistingData !== true)
    findings.push(`${file}: backfill must declare changesExistingData`);
}

function selfTest() {
  const evidence = Object.fromEntries(
    ledger.requiredEvidence.map((key) => [key, `dist/ci/${key}.json`]),
  );
  const strictEntry = {
    backupRestoreValidated: true,
    changesExistingData: false,
    evidence,
    file: "0020_example.sql",
    phase: "expand",
    previousVersionCompatible: true,
    repairStrategy: "Retain additive schema and roll back the application.",
    restartSafe: true,
    sha256: sha256('CREATE TABLE "example" ("id" text PRIMARY KEY);'),
    tenantPurgeValidated: true,
  };
  const state = {
    contents: new Map([
      [strictEntry.file, 'CREATE TABLE "example" ("id" text PRIMARY KEY);'],
    ]),
    files: [strictEntry.file],
    journal: { entries: [{ tag: "0020_example" }] },
    ledger: {
      ...ledger,
      lockedBaseline: [],
      migrations: [strictEntry],
      strictPolicyStartsAt: 20,
    },
  };
  const checks = [
    ["valid strict fixture", validate(state).length === 0],
    [
      "digest mutation",
      validate({
        ...state,
        contents: new Map([[strictEntry.file, "SELECT 1;"]]),
      }).some((item) => item.includes("digest changed")),
    ],
    [
      "destructive expand",
      validate({
        ...state,
        contents: new Map([[strictEntry.file, "DROP TABLE example;"]]),
        ledger: {
          ...state.ledger,
          migrations: [
            { ...strictEntry, sha256: sha256("DROP TABLE example;") },
          ],
        },
      }).some((item) => item.includes("contract phase")),
    ],
    [
      "missing evidence",
      validate({
        ...state,
        ledger: {
          ...state.ledger,
          migrations: [{ ...strictEntry, evidence: {} }],
        },
      }).some((item) => item.includes("evidence.")),
    ],
  ];
  return checks.flatMap(([name, passed]) =>
    passed ? [] : [`policy self-test failed: ${name}`],
  );
}

function addInventory(inventory, file, entry, findings) {
  if (inventory.has(file))
    findings.push(`${file} appears more than once in the ledger`);
  inventory.set(file, entry);
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/gu, " ").replace(/\/\*[\s\S]*?\*\//gu, " ");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isPhase(value) {
  return ["backfill", "baseline", "contract", "expand"].includes(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeEvidencePath(value) {
  return (
    isNonEmptyString(value) &&
    (value.startsWith("dist/ci/") || value.startsWith("dist/evidence/")) &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}
