import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "apps/app/src");
const baselinePath = path.join(
  root,
  "scripts/app-mutation-policy-baseline.json",
);

function inspectSource(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = {
    broadInvalidations: 0,
    cacheWrites: 0,
    rootInvalidations: [],
    unmanagedMutations: 0,
    invalidManagedCalls: [],
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name === "useMutation") {
        const options = node.arguments[0];
        if (options === undefined || ts.isObjectLiteralExpression(options)) {
          findings.unmanagedMutations += 1;
        } else if (
          !ts.isCallExpression(options) ||
          !/(?:Mutation|MutationOptions)$/u.test(
            callName(options.expression) ?? "",
          )
        ) {
          findings.invalidManagedCalls.push(position(sourceFile, node));
        }
      }
      if (name === "invalidateQueries") {
        const options = node.arguments[0];
        if (
          options === undefined ||
          (ts.isObjectLiteralExpression(options) &&
            options.properties.length === 0)
        ) {
          findings.rootInvalidations.push(position(sourceFile, node));
        } else if (
          !ts.isObjectLiteralExpression(options) ||
          !hasTrueProperty(options, "exact")
        ) {
          findings.broadInvalidations += 1;
        }
      }
      if (
        file.includes("/components/") &&
        [
          "cancelQueries",
          "removeQueries",
          "setQueriesData",
          "setQueryData",
        ].includes(name ?? "")
      ) {
        findings.cacheWrites += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function hasTrueProperty(object, name) {
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText() === name &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

function position(sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return `${sourceFile.fileName}:${line + 1}`;
}

async function productionFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await productionFiles(absolute)));
    } else if (
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)
    ) {
      files.push(absolute);
    }
  }
  return files;
}

function compactInventory(inventory) {
  return Object.fromEntries(
    Object.entries(inventory).filter(([, counts]) =>
      Object.values(counts).some((count) => count > 0),
    ),
  );
}

function compareInventory(actual, baseline) {
  const failures = [];
  for (const [file, counts] of Object.entries(actual)) {
    const allowed = baseline[file] ?? {};
    for (const metric of [
      "broadInvalidations",
      "cacheWrites",
      "unmanagedMutations",
    ]) {
      if ((counts[metric] ?? 0) > (allowed[metric] ?? 0)) {
        failures.push(
          `${file}: ${metric} increased from ${allowed[metric] ?? 0} to ${counts[metric]}`,
        );
      }
    }
  }
  return failures;
}

function runSelfTest() {
  const inline = inspectSource(
    "const value = useMutation({ mutationFn: save, onSuccess: refresh });",
    "/app/src/components/Inline.tsx",
  );
  const managed = inspectSource(
    "const value = useMutation(saveResourceMutationOptions());",
    "/app/src/components/Managed.tsx",
  );
  const hiddenPolicy = inspectSource(
    "const value = useMutation(options);",
    "/app/src/components/Hidden.tsx",
  );
  const rootInvalidation = inspectSource(
    "client.invalidateQueries();",
    "/app/src/components/Root.tsx",
  );
  const broadInvalidation = inspectSource(
    "client.invalidateQueries({ queryKey: keys.root() });",
    "/app/src/components/Broad.tsx",
  );
  const exactInvalidation = inspectSource(
    "client.invalidateQueries({ exact: true, queryKey: keys.item(id) });",
    "/app/src/components/Exact.tsx",
  );
  const componentCacheWrite = inspectSource(
    "client.setQueryData(keys.item(id), value);",
    "/app/src/components/Write.tsx",
  );
  if (
    inline.unmanagedMutations !== 1 ||
    managed.unmanagedMutations !== 0 ||
    managed.invalidManagedCalls.length !== 0 ||
    hiddenPolicy.invalidManagedCalls.length !== 1 ||
    rootInvalidation.rootInvalidations.length !== 1 ||
    broadInvalidation.broadInvalidations !== 1 ||
    exactInvalidation.broadInvalidations !== 0 ||
    componentCacheWrite.cacheWrites !== 1
  ) {
    throw new Error("Mutation-policy contract self-test failed.");
  }
  process.stdout.write("Mutation-policy contract self-test passed.\n");
}

if (process.argv.includes("--self-test")) runSelfTest();
if (process.argv.length === 3 && process.argv.includes("--self-test")) {
  process.exit(0);
}

const inventory = {};
const hardFailures = [];
for (const absolute of await productionFiles(sourceRoot)) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  const findings = inspectSource(
    await readFile(absolute, "utf8"),
    `/${relative}`,
  );
  inventory[relative] = {
    broadInvalidations: findings.broadInvalidations,
    cacheWrites: findings.cacheWrites,
    unmanagedMutations: findings.unmanagedMutations,
  };
  hardFailures.push(...findings.rootInvalidations);
  hardFailures.push(...findings.invalidManagedCalls);
}
const compact = compactInventory(inventory);
if (process.argv.includes("--print-baseline")) {
  process.stdout.write(`${JSON.stringify(compact, null, 2)}\n`);
  process.exit(0);
}
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const failures = [
  ...hardFailures,
  ...compareInventory(compact, baseline.files),
];
const totals = Object.values(compact).reduce(
  (sum, value) => ({
    broadInvalidations: sum.broadInvalidations + value.broadInvalidations,
    cacheWrites: sum.cacheWrites + value.cacheWrites,
    unmanagedMutations: sum.unmanagedMutations + value.unmanagedMutations,
  }),
  { broadInvalidations: 0, cacheWrites: 0, unmanagedMutations: 0 },
);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `Mutation-policy contracts passed; residual inventory: ${totals.unmanagedMutations} unmanaged observers, ${totals.broadInvalidations} non-exact invalidations, ${totals.cacheWrites} component cache writes.\n`,
);
