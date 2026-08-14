/**
 * Turn a model completion into a safe sidebar title.
 * Models often ignore the "plain words only" instruction and emit fences,
 * labels, or JSON — reject those and fall back to the user's first message.
 */

const LANGUAGE_TAGS = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "js",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "md",
  "php",
  "python",
  "py",
  "r",
  "ruby",
  "rust",
  "shell",
  "sh",
  "sql",
  "swift",
  "text",
  "ts",
  "tsx",
  "typescript",
  "xml",
  "yaml",
  "yml",
  "plaintext",
]);

export function normalizeGeneratedTitle(
  generated: string,
  fallback: string,
): string {
  let value = generated.trim();
  if (value.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        const title = Reflect.get(parsed, "title");
        if (typeof title === "string") value = title;
      }
    } catch {
      // Treat non-JSON provider output as a plain-text title.
    }
  }

  // Fenced model dumps are never titles. Keep only plain text that appears
  // before the first fence, and only when it already looks like a phrase.
  if (/```|~~~/u.test(value)) {
    const beforeFence = value.split(/```|~~~/u)[0]?.trim() ?? "";
    const words = beforeFence.split(/\s+/u).filter(Boolean);
    value =
      words.length >= 2 && !isGarbageTitle(beforeFence) ? beforeFence : "";
  } else {
    // Prefer the first non-empty line that is not a fence marker.
    const line =
      value
        .split(/\r?\n/u)
        .map((part) => part.trim())
        .find((part) => part.length > 0 && !isFenceLine(part)) ?? "";
    value = line;
  }

  value = value
    .replace(/^#+\s*/u, "")
    .replace(/^title:\s*/iu, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/gu, "")
    .replace(/`+/gu, "")
    .trim();

  if (/^Romeo .+ response:/u.test(value)) value = "";
  if (isGarbageTitle(value)) value = fallbackTitle(fallback);

  return value.split(/\s+/u).slice(0, 6).join(" ").slice(0, 80).trim();
}

export function fallbackTitle(content: string): string {
  const words = content
    .trim()
    .replace(/\s+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);
  const title = words.join(" ").replace(/[.!?,:;]+$/gu, "");
  return title.length > 0 ? title.slice(0, 80) : "New conversation";
}

function isFenceLine(line: string): boolean {
  return /^```+/u.test(line) || line === "~~~" || /^~~~+/u.test(line);
}

function isGarbageTitle(value: string): boolean {
  if (value.length === 0) return true;
  if (isFenceLine(value)) return true;
  if (value.startsWith("```") || value.endsWith("```")) return true;
  // Bare language tags from fenced blocks ("python", "```python").
  const stripped = value
    .replace(/^`+|`+$/gu, "")
    .trim()
    .toLowerCase();
  if (LANGUAGE_TAGS.has(stripped)) return true;
  // Punctuation / symbol only.
  if (!/[\p{L}\p{N}]/u.test(value)) return true;
  // Model dump that looks like an unfinished fence open.
  if (/^`{1,3}\w*$/u.test(value)) return true;
  // One-liner code, not a title: print(1), foo.bar(), name = "x"
  if (/^[a-z_][\w.]*\s*\(/iu.test(value)) return true;
  if (/[=;{}[\]]/u.test(value) && value.split(/\s+/u).length <= 4) return true;
  return false;
}
