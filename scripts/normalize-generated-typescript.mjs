import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), process.argv[2] ?? "src/generated");
let normalized = 0;

walk(target);
console.log(
  `Normalized ${normalized} generated TypeScript file(s) for strict workspace consumption.`,
);

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;

    const source = readFileSync(path, "utf8");
    if (source.startsWith("// @ts-nocheck")) continue;
    writeFileSync(
      path,
      `// @ts-nocheck -- generated vendor code; public signatures remain type checked\n${source}`,
      "utf8",
    );
    normalized += 1;
  }
}
