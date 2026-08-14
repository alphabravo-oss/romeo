import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const appSource = join(root, "apps/app/src");
const appQueryKeysFile = join(appSource, "lib/app-query-keys.ts");
const generatedQueryOptionsFile = join(
  root,
  "packages/api-client/src/generated/query/@tanstack/react-query.gen.ts",
);

const scopedKeyDimensions = new Map([
  ["adminAnalyticsSummary", ["range"]],
  ["agentKnowledgeBindings", ["agentId"]],
  ["agentReadiness", ["agentId", "principalType", "principalId"]],
  ["agentShares", ["agentId"]],
  ["agentTools", ["agentId"]],
  ["agentVersions", ["agentId"]],
  ["auditLogs", ["request"]],
  ["chat", ["chatId"]],
  ["chatComments", ["chatId"]],
  ["chatSearch", ["workspaceId", "query"]],
  ["chatShares", ["chatId", "purpose"]],
  ["chats", ["workspaceId", "view"]],
  ["chatsByTag", ["tag"]],
  ["commandCatalog", ["resource", "workspaceId"]],
  ["dataConnectorSyncs", ["connectorId"]],
  ["dataConnectors", ["workspaceId"]],
  ["delegatedOAuthConnections", ["workspaceId"]],
  ["evalDashboard", ["agentId"]],
  ["evalRatings", ["runId"]],
  ["evalResults", ["runId"]],
  ["evalRuns", ["agentId"]],
  ["evalSuites", ["agentId"]],
  ["files", ["workspaceId", "scope"]],
  ["folderItems", ["folderId"]],
  ["folderItemsBatch", ["workspaceId", "folderIds", "limitPerFolder"]],
  ["folders", ["workspaceId"]],
  ["groups", ["groupId", "view"]],
  ["knowledgeBases", ["workspaceId"]],
  ["knowledgeShares", ["knowledgeBaseId"]],
  ["knowledgeSources", ["knowledgeBaseId"]],
  ["managedModelCustomizationPolicy", ["agentId"]],
  ["managedModelPreferences", ["agentId"]],
  ["messageFeedback", ["chatId"]],
  ["messages", ["chatId"]],
  ["modelShares", ["modelId"]],
  ["personalContent", ["kind", "workspaceId", "page"]],
  ["promptMarketplace", ["workspaceId"]],
  ["promptTemplates", ["workspaceId", "scope"]],
  ["queuedTurns", ["chatId"]],
  ["routerSession", ["locale"]],
  ["routeWorkspaceSelection", ["workspaceId", "chatId"]],
  ["shareTargets", ["scope"]],
  ["tablePages", ["request"]],
  ["streamingMessage", ["chatId", "messageId"]],
  ["toolCalls", ["agentId"]],
  ["toolOperations", ["connectorId"]],
  ["usageEvents", ["range"]],
  ["users", ["filters"]],
  ["webhookDeliveries", ["webhookId", "page"]],
  ["webhooks", ["workspaceId"]],
  ["workflowRuns", ["workflowId"]],
  ["workflowTemplates", ["workspaceId"]],
  ["workflows", ["workspaceId"]],
  ["workspaceCapabilities", ["workspaceId"]],
  ["workspaceMembers", ["workspaceId"]],
]);

const queryClientKeyMethods = new Set([
  "ensureQueryData",
  "fetchQuery",
  "getQueryData",
  "getQueryState",
  "prefetchQuery",
  "setQueryData",
]);
const liveKeyFactories = new Set(["messages", "streamingMessage"]);
const liveKeyOwners = new Set([
  "apps/app/src/components/StreamingAssistantMessage.tsx",
  "apps/app/src/lib/run-registry-messages.ts",
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(entry.name)) return [];
    return [path];
  });
}

function violationsFor(sourceText, file) {
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
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "queryKey" &&
      ts.isArrayLiteralExpression(unwrapExpression(node.initializer))
    ) {
      report(node, "inline queryKey array");
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /(?:^|_)KEY$/u.test(node.name.text) &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(unwrapExpression(node.initializer))
    ) {
      report(node, "shared handwritten key array");
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      queryClientKeyMethods.has(node.expression.name.text) &&
      node.arguments[0] !== undefined &&
      ts.isArrayLiteralExpression(unwrapExpression(node.arguments[0]))
    ) {
      report(node, `raw ${node.expression.name.text} key`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "appQueryKeys" &&
      liveKeyFactories.has(node.name.text) &&
      !liveKeyOwners.has(file)
    ) {
      report(node, `${node.name.text} live key used outside registry owner`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

function registryViolations(sourceText, generatedSource = "") {
  const source = ts.createSourceFile(
    "app-query-keys.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const factories = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined
      )
        continue;
      const roots = new Set();
      collectKeyRoots(declaration.initializer, roots);
      if (roots.size > 0) {
        factories.set(declaration.name.text, {
          initializer: declaration.initializer,
          roots,
        });
      }
    }
  }

  const violations = [];
  const ownersByRoot = new Map();
  for (const [name, factory] of factories) {
    if (factory.roots.size !== 1) {
      violations.push(`${name} must declare exactly one stable root identity`);
      continue;
    }
    const [keyRoot] = factory.roots;
    const owners = ownersByRoot.get(keyRoot) ?? [];
    owners.push(name);
    ownersByRoot.set(keyRoot, owners);
    for (const dimension of scopedKeyDimensions.get(name) ?? []) {
      if (!containsKeyDimension(factory.initializer, dimension)) {
        violations.push(`${name} key is missing its ${dimension} dimension`);
      }
    }
  }
  for (const [keyRoot, owners] of ownersByRoot) {
    if (owners.length > 1) {
      violations.push(
        `key root ${keyRoot} collides across ${owners.sort().join(", ")}`,
      );
    }
  }

  const generatedIds = new Set(
    [...generatedSource.matchAll(/createQueryKey\("([^"]+)"/gu)].map(
      (match) => match[1],
    ),
  );
  for (const keyRoot of ownersByRoot.keys()) {
    if (generatedIds.has(keyRoot)) {
      violations.push(`app key root ${keyRoot} collides with a generated key`);
    }
  }
  return violations;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function collectKeyRoots(node, roots) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "resourceKey" &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    roots.add(node.arguments[0].text);
  }
  if (ts.isArrayLiteralExpression(node)) {
    const [first] = node.elements;
    if (first && ts.isStringLiteral(first)) roots.add(first.text);
  }
  ts.forEachChild(node, (child) => collectKeyRoots(child, roots));
}

function containsKeyDimension(node, identifier) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "resourceKey"
    ) {
      for (const argument of current.arguments.slice(1)) {
        if (containsIdentifier(argument, identifier)) {
          found = true;
          return;
        }
      }
    }
    if (ts.isArrayLiteralExpression(current)) {
      for (const element of current.elements.slice(1)) {
        if (containsIdentifier(element, identifier)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function containsIdentifier(node, identifier) {
  if (ts.isIdentifier(node) && node.text === identifier) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsIdentifier(child, identifier)) found = true;
  });
  return found;
}

if (process.argv.includes("--self-test")) {
  const inline = violationsFor(
    `const value = { queryKey: ["jobs"] };`,
    "apps/app/src/example.ts",
  );
  const rawSetter = violationsFor(
    `queryClient.setQueryData(["jobs"], []);`,
    "apps/app/src/example.ts",
  );
  const shared = violationsFor(
    `const JOBS_KEY = ["jobs"] as const;`,
    "apps/app/src/example.ts",
  );
  const liveOutside = violationsFor(
    `appQueryKeys.streamingMessage(chatId, messageId);`,
    "apps/app/src/example.ts",
  );
  const liveOwner = violationsFor(
    `appQueryKeys.streamingMessage(chatId, messageId);`,
    "apps/app/src/lib/run-registry-messages.ts",
  );
  const validRegistry = registryViolations(`
    export const chat = (chatId) => ["chat", { chatId }];
    export const messages = (chatId) => ["messages", { chatId }];
  `);
  const collidingRegistry = registryViolations(`
    export const first = () => ["same"];
    export const second = () => ["same"];
  `);
  const unscopedRegistry = registryViolations(`
    export const chat = (_chatId) => ["chat"];
  `);
  if (
    inline.length !== 1 ||
    rawSetter.length !== 1 ||
    shared.length !== 1 ||
    liveOutside.length !== 1 ||
    liveOwner.length !== 0 ||
    validRegistry.length !== 0 ||
    collidingRegistry.length !== 1 ||
    unscopedRegistry.length !== 1
  )
    process.exit(1);
  console.log("Query-key contract self-test passed.");
  process.exit(0);
}

const violations = sourceFiles(appSource).flatMap((absoluteFile) => {
  const file = relative(root, absoluteFile);
  return violationsFor(readFileSync(absoluteFile, "utf8"), file);
});
violations.push(
  ...registryViolations(
    readFileSync(appQueryKeysFile, "utf8"),
    readFileSync(generatedQueryOptionsFile, "utf8"),
  ).map((message) => `apps/app/src/lib/app-query-keys.ts (${message})`),
);

if (violations.length > 0) {
  console.error(
    "Server query keys must use generated options or a typed appQueryKeys factory:\n" +
      violations.map((item) => `- ${item}`).join("\n"),
  );
  process.exit(1);
}
console.log("App query-key contracts passed.");
