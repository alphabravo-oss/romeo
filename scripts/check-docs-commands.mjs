import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  process.cwd(),
  argValue("--output") ?? "dist/ci/docs-command-check.json",
);
const packageJson = readJson(resolve(root, "package.json"));
const rootScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const workspacePackages = discoverWorkspacePackages();
const cliCommands = discoverCliCommands();
const requiredMarkdownFiles = [
  resolve(root, "../romeo-full-product-prd.md"),
  resolve(root, "README.md"),
  resolve(root, "scripts/README.md"),
];
const optionalMarkdownFiles = [
  resolve(root, "../open-agent-workspace-full-prd.md"),
];
const markdownFiles = discoverMarkdownFiles();
const shellBlocks = markdownFiles.flatMap(readShellBlocks);
const markdownLinks = markdownFiles.flatMap(readMarkdownLinks);
const commands = shellBlocks.flatMap(commandsFromBlock);
const failures = [];
const commandPosture = {
  total: commands.length,
  classified: 0,
  unclassified: 0,
  categories: {
    assignmentOnly: 0,
    deploymentCommandChecked: 0,
    environmentSpecific: 0,
    nodeScriptChecked: 0,
    operatorShellUtility: 0,
    pnpmBuiltinOrPackageCommand: 0,
    pnpmScriptChecked: 0,
    romeoCliChecked: 0,
    workspaceFilterChecked: 0,
  },
  everyCommandClassified: false,
  rawCommandTextReturned: false,
};
const stats = {
  pnpmCommands: 0,
  pnpmScriptsChecked: 0,
  cliCommands: 0,
  cliCommandsChecked: 0,
  deploymentPathsChecked: 0,
  markdownFiles: markdownFiles.length,
  shellBlocks: shellBlocks.length,
  markdownLinks: markdownLinks.length,
  markdownLinksChecked: 0,
  markdownAnchorLinksChecked: 0,
  commands: commands.length,
};
const markdownAnchorCache = new Map();

validateRequiredMarkdownFiles();

for (const link of markdownLinks) {
  validateMarkdownLink(link);
}

for (const command of commands) {
  validateCommand(command);
}

const evidence = {
  schemaVersion: "romeo.docs-command-check.v1",
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "passed" : "failed",
  checks: [
    "markdown_shell_blocks_parse",
    "documented_pnpm_scripts_exist",
    "documented_workspace_filters_exist",
    "documented_cli_commands_exist",
    "documented_compose_files_exist",
    "documented_helm_and_kubectl_files_exist",
    "documented_node_scripts_exist",
    "documented_markdown_links_resolve",
    "documented_commands_classified",
    "canonical_root_prd_scanned",
    "docs_command_check_redaction_flags",
  ],
  scannedFiles: markdownFiles.map((path) => ({
    path: relative(root, path),
    sha256: sha256File(path),
    bytes: statSync(path).size,
  })),
  stats,
  commandPosture,
  failures,
  redaction: {
    rawMarkdownBodiesReturned: false,
    rawShellCommandTextReturned: false,
    environmentValuesReturned: false,
    secretValuesReturned: false,
  },
};

writeJson(outputPath, evidence);
if (failures.length > 0) {
  console.error(`Docs command check failed with ${failures.length} issue(s).`);
  process.exit(1);
}
console.log(`Wrote docs command check evidence to ${outputPath}`);

function discoverMarkdownFiles() {
  return unique([
    ...requiredMarkdownFiles,
    ...optionalMarkdownFiles,
    ...listFiles(resolve(root, "docs")).filter((path) => path.endsWith(".md")),
  ])
    .filter((path) => existsSync(path))
    .sort();
}

function validateRequiredMarkdownFiles() {
  for (const path of requiredMarkdownFiles) {
    if (existsSync(path)) continue;
    fail(
      {
        file: "scripts/check-docs-commands.mjs",
        line: 1,
      },
      "missing_required_markdown_file",
      { path: relative(root, path) },
    );
  }
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function readShellBlocks(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);
  const blocks = [];
  let activeBlock;
  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(/^```([A-Za-z0-9_-]*)\s*$/u);
    if (fence !== null) {
      if (activeBlock === undefined) {
        activeBlock = {
          language: fence[1],
          startLine: index + 1,
          lines: [],
          path,
        };
      } else {
        if (isShellLanguage(activeBlock.language)) blocks.push(activeBlock);
        activeBlock = undefined;
      }
      continue;
    }
    activeBlock?.lines.push(lines[index]);
  }
  return blocks;
}

function readMarkdownLinks(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);
  const links = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/u.test(line.trim())) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/gu)) {
      const target = markdownLinkDestination(match[1]);
      if (target === undefined || !isLocalMarkdownTarget(target)) continue;
      links.push({
        file: relative(root, path),
        line: index + 1,
        sourcePath: path,
        target,
      });
    }
  }
  return links;
}

function markdownLinkDestination(raw) {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  if (value.startsWith("<")) {
    const close = value.indexOf(">");
    return close < 0 ? undefined : value.slice(1, close);
  }
  return value.split(/\s+/u)[0];
}

function isLocalMarkdownTarget(target) {
  if (
    target.startsWith("$") ||
    target.startsWith("//") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("tel:")
  ) {
    return false;
  }
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target);
}

function validateMarkdownLink(link) {
  stats.markdownLinksChecked += 1;
  const { pathPart, anchor } = splitMarkdownTarget(link.target);
  const targetPath =
    pathPart.length === 0
      ? link.sourcePath
      : resolve(dirname(link.sourcePath), safeDecode(pathPart));
  if (!existsSync(targetPath)) {
    fail(link, "broken_markdown_link", {
      target: relative(root, targetPath),
    });
    return;
  }
  if (anchor === undefined || !isMarkdownFile(targetPath)) return;
  stats.markdownAnchorLinksChecked += 1;
  const decodedAnchor = safeDecode(anchor).replace(/^#+/u, "");
  if (!markdownAnchors(targetPath).has(decodedAnchor)) {
    fail(link, "missing_markdown_anchor", {
      target: relative(root, targetPath),
      anchor: decodedAnchor,
    });
  }
}

function splitMarkdownTarget(target) {
  const hashIndex = target.indexOf("#");
  const rawPath = hashIndex < 0 ? target : target.slice(0, hashIndex);
  const rawAnchor = hashIndex < 0 ? undefined : target.slice(hashIndex + 1);
  return {
    pathPart: rawPath.split("?")[0],
    anchor: rawAnchor === "" ? undefined : rawAnchor,
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isMarkdownFile(path) {
  return path.endsWith(".md") || path.endsWith(".markdown");
}

function markdownAnchors(path) {
  const cached = markdownAnchorCache.get(path);
  if (cached !== undefined) return cached;
  const anchors = new Set();
  const slugCounts = new Map();
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    for (const anchor of htmlAnchors(line)) anchors.add(anchor);
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (heading === null) continue;
    const base = markdownHeadingSlug(heading[1]);
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  markdownAnchorCache.set(path, anchors);
  return anchors;
}

function htmlAnchors(line) {
  return Array.from(
    line.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/giu),
    (match) => match[1],
  );
}

function markdownHeadingSlug(value) {
  return value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/&[A-Za-z0-9#]+;/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/\s+/gu, "-");
}

function isShellLanguage(language) {
  return ["bash", "sh", "shell"].includes(language);
}

function commandsFromBlock(block) {
  const commands = [];
  let current = "";
  for (let offset = 0; offset < block.lines.length; offset += 1) {
    const trimmed = block.lines[offset].trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (isHereDocBoundary(trimmed)) continue;
    if (trimmed.endsWith("\\")) {
      current += `${trimmed.slice(0, -1)} `;
      continue;
    }
    current += trimmed;
    for (const fragment of splitShellFragments(current)) {
      commands.push({
        file: relative(root, block.path),
        line: block.startLine + offset,
        raw: fragment,
        tokens: shellTokens(fragment),
      });
    }
    current = "";
  }
  if (current.trim().length > 0) {
    commands.push({
      file: relative(root, block.path),
      line: block.startLine + block.lines.length,
      raw: current.trim(),
      tokens: shellTokens(current.trim()),
    });
  }
  return commands.filter((command) => command.tokens.length > 0);
}

function splitShellFragments(command) {
  return command
    .split(/\s+(?:&&|\|\|)\s+|;\s*/u)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
}

function shellTokens(command) {
  const tokens = [];
  let current = "";
  let quote;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function validateCommand(command) {
  const tokens = withoutEnvironmentAssignments(command.tokens);
  if (tokens.length === 0 || isAssignmentOnly(tokens)) {
    recordCommandCategory("assignmentOnly");
    return;
  }
  const executable = tokens[0];
  if (executable === "pnpm") return validatePnpm(command, tokens);
  if (executable === "romeo") return validateRomeoCli(command, tokens);
  if (executable === "docker") return validateDocker(command, tokens);
  if (executable === "helm") return validateHelm(command, tokens);
  if (executable === "kubectl") return validateKubectl(command, tokens);
  if (executable === "node") return validateNode(command, tokens);
  if (isEnvironmentSpecificExecutable(executable)) {
    recordCommandCategory("environmentSpecific");
    return;
  }
  if (isOperatorShellUtility(executable)) {
    recordCommandCategory("operatorShellUtility");
    return;
  }
  recordUnclassifiedCommand(command, executable);
}

function withoutEnvironmentAssignments(tokens) {
  let index = 0;
  while (
    index < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])
  ) {
    index += 1;
  }
  return tokens.slice(index);
}

function isAssignmentOnly(tokens) {
  return tokens.every((token) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token));
}

function validatePnpm(command, tokens) {
  stats.pnpmCommands += 1;
  const args = tokens.slice(1);
  if (args[0] === "--filter") {
    recordCommandCategory("workspaceFilterChecked");
    const packageName = args[1];
    if (!workspacePackages.has(packageName)) {
      fail(command, "unknown_workspace_filter", { packageName });
    }
    return;
  }
  if (args[0] === "run") {
    recordCommandCategory("pnpmScriptChecked");
    const script = args[1];
    stats.pnpmScriptsChecked += 1;
    if (script === undefined || !rootScripts.has(script)) {
      fail(command, "unknown_pnpm_script", { script });
    }
    return;
  }
  if (["install", "exec", "dlx", "add", "remove"].includes(args[0])) {
    recordCommandCategory("pnpmBuiltinOrPackageCommand");
    return;
  }
  const script = args.find((arg) => !arg.startsWith("-"));
  if (script === undefined) {
    recordCommandCategory("pnpmBuiltinOrPackageCommand");
    return;
  }
  recordCommandCategory("pnpmScriptChecked");
  stats.pnpmScriptsChecked += 1;
  if (!rootScripts.has(script))
    fail(command, "unknown_pnpm_script", { script });
}

function validateRomeoCli(command, tokens) {
  recordCommandCategory("romeoCliChecked");
  stats.cliCommands += 1;
  const area = tokens[1];
  if (area === undefined || area.startsWith("-")) return;
  const action = tokens[2]?.startsWith("-") === true ? undefined : tokens[2];
  const key = action === undefined ? area : `${area} ${action}`;
  stats.cliCommandsChecked += 1;
  if (!cliCommands.has(key) && !cliCommands.has(area)) {
    fail(command, "unknown_romeo_cli_command", { command: key });
  }
}

function validateDocker(command, tokens) {
  recordCommandCategory("deploymentCommandChecked");
  if (tokens[1] !== "compose") return;
  validateFlagPaths(command, tokens, ["-f", "--file"], "compose_file");
}

function validateHelm(command, tokens) {
  recordCommandCategory("deploymentCommandChecked");
  for (const token of tokens.slice(1)) {
    if (token.startsWith("deploy/")) validatePath(command, token, "helm_path");
  }
  validateFlagPaths(command, tokens, ["-f", "--values"], "helm_values_file");
}

function validateKubectl(command, tokens) {
  recordCommandCategory("deploymentCommandChecked");
  validateFlagPaths(command, tokens, ["-f", "--filename"], "kubectl_file");
}

function validateNode(command, tokens) {
  recordCommandCategory("nodeScriptChecked");
  const scriptPath = tokens[1];
  if (scriptPath?.startsWith("scripts/") === true) {
    validatePath(command, scriptPath, "node_script");
  }
}

function recordCommandCategory(category) {
  commandPosture.classified += 1;
  commandPosture.categories[category] += 1;
  commandPosture.everyCommandClassified =
    commandPosture.classified === commandPosture.total &&
    commandPosture.unclassified === 0;
}

function recordUnclassifiedCommand(command, executable) {
  commandPosture.unclassified += 1;
  commandPosture.everyCommandClassified = false;
  fail(command, "unclassified_documented_command", {
    executable: executable.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 80),
  });
}

function isEnvironmentSpecificExecutable(executable) {
  return [
    "aws",
    "az",
    "cosign",
    "curl",
    "gh",
    "gcloud",
    "npm",
    "oras",
    "psql",
  ].includes(executable);
}

function isOperatorShellUtility(executable) {
  return [
    "base64",
    "cat",
    "cd",
    "chmod",
    "cp",
    "date",
    "export",
    "find",
    "jq",
    "mkdir",
    "mv",
    "open",
    "openssl",
    "rm",
    "tar",
    "test",
  ].includes(executable);
}

function validateFlagPaths(command, tokens, flags, reason) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!flags.includes(tokens[index])) continue;
    const path = tokens[index + 1];
    if (path === undefined || path.startsWith("$") || path.startsWith("http")) {
      continue;
    }
    validatePath(command, path, reason);
  }
}

function validatePath(command, path, reason) {
  if (!path.startsWith("deploy/") && !path.startsWith("scripts/")) return;
  stats.deploymentPathsChecked += 1;
  if (!existsSync(resolve(root, path))) fail(command, reason, { path });
}

function discoverWorkspacePackages() {
  return new Set(
    ["apps", "packages"]
      .flatMap((dir) => packageJsonsInWorkspaceDir(resolve(root, dir)))
      .concat(resolve(root, "package.json"))
      .map((path) => readJson(path).name)
      .filter((name) => typeof name === "string"),
  );
}

function packageJsonsInWorkspaceDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

function discoverCliCommands() {
  const sourcePath = resolve(root, "packages/cli/src/commands.ts");
  if (!existsSync(sourcePath)) return new Set();
  const source = readFileSync(sourcePath, "utf8");
  const commands = new Set();
  for (const match of source.matchAll(
    /area === "([^"]+)"(?: && action === "([^"]+)")?/gu,
  )) {
    commands.add(match[2] === undefined ? match[1] : `${match[1]} ${match[2]}`);
  }
  return commands;
}

function isHereDocBoundary(line) {
  return line === "EOF" || line === "'EOF'" || line === '"EOF"';
}

function fail(command, reason, details) {
  failures.push({
    file: command.file,
    line: command.line,
    reason,
    details,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}
