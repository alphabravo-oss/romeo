import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const appSource = join(root, "apps/app/src");
const queryHooks = new Set([
  "useInfiniteQuery",
  "useQuery",
  "useSuspenseInfiniteQuery",
  "useSuspenseQuery",
]);
const queryClientMethods = new Set([
  "ensureInfiniteQueryData",
  "ensureQueryData",
  "fetchInfiniteQuery",
  "fetchQuery",
  "prefetchInfiniteQuery",
  "prefetchQuery",
]);
const optionBuilders = new Set(["infiniteQueryOptions", "queryOptions"]);
const streamingOwner = "apps/app/src/components/StreamingAssistantMessage.tsx";

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(entry.name)) return [];
    return [path];
  });
}

export function violationsFor(sourceText, file) {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const report = (node, message) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart());
    violations.push(`${file}:${position.line + 1} (${message})`);
  };
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const called = callName(node.expression);
      if (called !== undefined && queryHooks.has(called)) {
        const options = unwrapExpression(node.arguments[0]);
        if (
          options !== undefined &&
          !ts.isCallExpression(options) &&
          !(
            ts.isObjectLiteralExpression(options) &&
            isExactStreamingException(file, options)
          )
        ) {
          report(
            options,
            `${called} must consume a shared query-options factory`,
          );
        }
      }
      if (
        called !== undefined &&
        queryClientMethods.has(called) &&
        node.arguments[0] !== undefined &&
        ts.isObjectLiteralExpression(unwrapExpression(node.arguments[0]))
      ) {
        report(
          node.arguments[0],
          `${called} must consume a shared query-options factory`,
        );
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "queryFn" &&
      !isInsideOptionBuilder(node) &&
      !isExactStreamingQueryFn(file, node)
    ) {
      report(
        node,
        "queryFn must be owned by queryOptions/infiniteQueryOptions",
      );
    }
    if (
      ts.isCallExpression(node) &&
      optionBuilders.has(callName(node.expression) ?? "")
    ) {
      const options = unwrapExpression(node.arguments[0]);
      if (
        options !== undefined &&
        ts.isObjectLiteralExpression(options) &&
        hasProperty(options, "queryFn") &&
        !hasCachePolicySpread(options)
      ) {
        report(
          options,
          "query-options factory must select a shared cache policy/profile",
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (file === streamingOwner) {
    const streamingObjects = collectObjectLiterals(source).filter((object) =>
      isExactStreamingException(file, object),
    );
    if (streamingObjects.length !== 1) {
      violations.push(
        `${file}:1 (expected exactly one documented streaming-row exception)`,
      );
    }
  }
  return violations;
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function hasProperty(object, name) {
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === name,
  );
}

function hasCachePolicySpread(object) {
  return object.properties.some((property) => {
    if (!ts.isSpreadAssignment(property)) return false;
    const expression = unwrapExpression(property.expression);
    if (
      ts.isCallExpression(expression) &&
      callName(expression.expression) === "serverQueryPolicy"
    ) {
      return true;
    }
    return (
      ts.isElementAccessExpression(expression) ||
      (ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "queryCacheProfiles")
    );
  });
}

function unwrapExpression(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function isInsideOptionBuilder(node) {
  for (
    let current = node.parent;
    current !== undefined;
    current = current.parent
  ) {
    if (ts.isCallExpression(current)) {
      const called = callName(current.expression);
      if (called !== undefined && optionBuilders.has(called)) return true;
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      return false;
    }
  }
  return false;
}

function isExactStreamingQueryFn(file, node) {
  return (
    file === streamingOwner &&
    ts.isIdentifier(unwrapExpression(node.initializer)) &&
    unwrapExpression(node.initializer).text === "skipToken"
  );
}

function isExactStreamingException(file, object) {
  if (file !== streamingOwner) return false;
  const properties = new Map();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = propertyName(property.name);
    if (name !== undefined) properties.set(name, property.initializer);
  }
  const queryFn = unwrapExpression(properties.get("queryFn"));
  const queryKey = unwrapExpression(properties.get("queryKey"));
  const allowedProperties = new Set([
    "gcTime",
    "initialData",
    "notifyOnChangeProps",
    "queryFn",
    "queryKey",
    "staleTime",
  ]);
  return (
    properties.size === allowedProperties.size &&
    [...properties.keys()].every((name) => allowedProperties.has(name)) &&
    ts.isIdentifier(queryFn) &&
    queryFn.text === "skipToken" &&
    ts.isCallExpression(queryKey) &&
    ts.isPropertyAccessExpression(queryKey.expression) &&
    ts.isIdentifier(queryKey.expression.expression) &&
    queryKey.expression.expression.text === "appQueryKeys" &&
    queryKey.expression.name.text === "streamingMessage"
  );
}

function collectObjectLiterals(source) {
  const objects = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) objects.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return objects;
}

if (process.argv.includes("--self-test")) {
  const inline = violationsFor(
    `const result = useQuery({ queryKey: keys.jobs(), queryFn: listJobs });`,
    "apps/app/src/example.ts",
  );
  const callerOverride = violationsFor(
    `client.fetchQuery({ ...jobsQueryOptions(), staleTime: 0 });`,
    "apps/app/src/example.ts",
  );
  const detachedQueryFn = violationsFor(
    `const options = { queryKey: keys.jobs(), queryFn: listJobs };`,
    "apps/app/src/example.ts",
  );
  const valid = violationsFor(
    `const jobsQueryOptions = () => queryOptions({ ...serverQueryPolicy("volatile", "jobs"), queryKey: keys.jobs(), queryFn: ({ signal }) => listJobs(signal) }); const result = useQuery(jobsQueryOptions());`,
    "apps/app/src/example.ts",
  );
  const validStreaming = violationsFor(
    `const value = useQuery({ queryKey: appQueryKeys.streamingMessage(chatId, messageId), queryFn: skipToken, initialData: fallback, gcTime: 30_000, staleTime: Infinity, notifyOnChangeProps: ["data"] });`,
    streamingOwner,
  );
  const hiddenOverride = violationsFor(
    `const options = { ...jobsQueryOptions(), staleTime: 0 }; const result = useQuery(options);`,
    "apps/app/src/example.ts",
  );
  if (
    inline.length !== 2 ||
    callerOverride.length !== 1 ||
    detachedQueryFn.length !== 1 ||
    hiddenOverride.length !== 1 ||
    valid.length !== 0 ||
    validStreaming.length !== 0
  ) {
    console.error({
      callerOverride,
      detachedQueryFn,
      hiddenOverride,
      inline,
      valid,
      validStreaming,
    });
    process.exit(1);
  }
  console.log("Query-option contract self-test passed.");
  process.exit(0);
}

const violations = sourceFiles(appSource).flatMap((absoluteFile) =>
  violationsFor(
    readFileSync(absoluteFile, "utf8"),
    relative(root, absoluteFile),
  ),
);
if (violations.length > 0) {
  console.error(
    "Server query behavior must be owned by shared query-options factories:\n" +
      violations.map((item) => `- ${item}`).join("\n"),
  );
  process.exit(1);
}
console.log("App query-option contracts passed.");
