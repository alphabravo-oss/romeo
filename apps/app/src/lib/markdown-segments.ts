export interface MarkdownSegment {
  content: string;
  start: number;
}

export interface MarkdownSegmentation {
  monolithic: boolean;
  source: string;
  stable: MarkdownSegment[];
  tail: MarkdownSegment;
}

export interface MarkdownFeatures {
  fencedCode: boolean;
  math: boolean;
}

export function absoluteMarkdownOffset(
  segmentStart: number,
  relativeOffset: number | undefined,
): number | undefined {
  return relativeOffset === undefined
    ? undefined
    : segmentStart + relativeOffset;
}

const fenceOpener = /^ {0,3}(`{3,}|~{3,})/u;
const listItem = /^ {0,3}(?:[-+*]|\d+[.)])\s+/u;
const indented = /^(?: {4}|\t)/u;
const quote = /^ {0,3}>/u;
const referenceDefinition = /^ {0,3}\[[^\]\n]+\]:/mu;
const referenceLink = /\[[^\]\n]+\]\s*\[[^\]\n]*\]/u;
const shortcutReference = /(^|[^!\\])\[[^\]\n]+\](?![([])/u;
// A partial HTML opener can span future lines, so the mere opener is enough to
// keep the document monolithic. HTTP(S) autolinks are self-contained Markdown.
const rawHtml = /<(?!https?:\/\/)[A-Za-z!/]/u;
const taskMarker = /^ {0,3}[-+*]\s+\[[ xX]\]\s+/u;
const mathMarker = /(^|[^\\])(?:\$\$|\\\(|\\\[)/u;

/** Determines which optional parsers a mounted segment actually needs. */
export function detectMarkdownFeatures(source: string): MarkdownFeatures {
  let activeFence: string | undefined;
  let fencedCode = false;
  let math = false;
  for (const line of source.split("\n")) {
    const opener = fenceOpener.exec(line)?.[1];
    if (activeFence !== undefined) {
      if (
        opener !== undefined &&
        opener[0] === activeFence[0] &&
        opener.length >= activeFence.length
      ) {
        activeFence = undefined;
      }
      continue;
    }
    if (opener !== undefined) {
      fencedCode = true;
      activeFence = opener;
      continue;
    }
    if (mathMarker.test(stripInlineCode(line))) math = true;
  }
  return { fencedCode, math };
}

function stripInlineCode(line: string): string {
  return line
    .split(/(`+[^`]*`+)/u)
    .filter((_part, index) => index % 2 === 0)
    .join("");
}

/**
 * Incrementally extends a streaming segmentation plan. Only the former tail is
 * rescanned on append; stable source bytes and segment identities are retained.
 */
export function advanceMarkdownSegmentation(
  previous: MarkdownSegmentation | undefined,
  source: string,
): MarkdownSegmentation {
  if (previous === undefined || !source.startsWith(previous.source)) {
    return segmentFrom(source, 0, [], source);
  }
  if (previous.monolithic) {
    return {
      monolithic: true,
      source,
      stable: previous.stable,
      tail: { content: source, start: 0 },
    };
  }
  return segmentFrom(
    source.slice(previous.tail.start),
    previous.tail.start,
    previous.stable,
    source,
  );
}

export function segmentStreamingMarkdown(source: string): MarkdownSegmentation {
  return advanceMarkdownSegmentation(undefined, source);
}

function segmentFrom(
  suffix: string,
  baseOffset: number,
  stablePrefix: MarkdownSegment[],
  source: string,
): MarkdownSegmentation {
  if (hasGlobalDependency(suffix)) {
    return {
      monolithic: true,
      source,
      stable: [],
      tail: { content: source, start: 0 },
    };
  }
  const chunks = mergeContainerChunks(splitBlankDelimitedChunks(suffix));
  const stable = chunks.length > 1 ? [...stablePrefix] : stablePrefix;
  let offset = baseOffset;
  for (const chunk of chunks.slice(0, -1)) {
    stable.push({ content: chunk, start: offset });
    offset += chunk.length;
  }
  const tailContent = chunks.at(-1) ?? "";
  return {
    monolithic: false,
    source,
    stable,
    tail: { content: tailContent, start: offset },
  };
}

function hasGlobalDependency(source: string): boolean {
  if (
    referenceDefinition.test(source) ||
    referenceLink.test(source) ||
    rawHtml.test(source)
  )
    return true;
  return source.split("\n").some((line) => {
    if (taskMarker.test(line)) return false;
    return shortcutReference.test(line);
  });
}

function splitBlankDelimitedChunks(source: string): string[] {
  if (source.length === 0) return [];
  const chunks: string[] = [];
  let chunkStart = 0;
  let offset = 0;
  let fence: string | undefined;
  let displayMath:
    | { delimiter: "$"; length: number }
    | { delimiter: "[" }
    | undefined;
  const lines = source.match(/.*(?:\n|$)/gu) ?? [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) continue;
    const text = line.endsWith("\n") ? line.slice(0, -1) : line;
    const opener = fenceOpener.exec(text)?.[1];
    if (fence !== undefined) {
      if (
        opener !== undefined &&
        opener[0] === fence[0] &&
        opener.length >= fence.length &&
        text.slice(text.indexOf(opener) + opener.length).trim().length === 0
      )
        fence = undefined;
    } else if (opener !== undefined) {
      fence = opener;
    } else {
      displayMath = scanDisplayMath(text, displayMath);
    }
    offset += line.length;
    if (
      fence === undefined &&
      displayMath === undefined &&
      text.trim().length === 0
    ) {
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        const nextText = next.endsWith("\n") ? next.slice(0, -1) : next;
        if (nextText.trim().length > 0) break;
        index += 1;
        offset += next.length;
      }
      chunks.push(source.slice(chunkStart, offset));
      chunkStart = offset;
    }
  }
  if (chunkStart < source.length) chunks.push(source.slice(chunkStart));
  return chunks;
}

function scanDisplayMath(
  line: string,
  current: { delimiter: "$"; length: number } | { delimiter: "[" } | undefined,
): { delimiter: "$"; length: number } | { delimiter: "[" } | undefined {
  let state = current;
  if (state?.delimiter === "[") {
    return hasUnescapedToken(line, "\\]") ? undefined : state;
  }
  if (state === undefined && hasUnescapedToken(line, "\\[")) {
    return hasUnescapedToken(line, "\\]") ? undefined : { delimiter: "[" };
  }

  const runs = unescapedDollarRuns(line);
  for (const length of runs) {
    if (state?.delimiter === "$") {
      if (length >= state.length) state = undefined;
    } else if (length >= 2) {
      state = { delimiter: "$", length };
    }
  }
  return state;
}

function unescapedDollarRuns(line: string): number[] {
  const runs: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "$" || isEscaped(line, index)) continue;
    let end = index + 1;
    while (line[end] === "$") end += 1;
    runs.push(end - index);
    index = end - 1;
  }
  return runs;
}

function hasUnescapedToken(line: string, token: string): boolean {
  let offset = line.indexOf(token);
  while (offset >= 0) {
    if (!isEscaped(line, offset)) return true;
    offset = line.indexOf(token, offset + token.length);
  }
  return false;
}

function isEscaped(value: string, offset: number): boolean {
  let slashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && value[index] === "\\";
    index -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function mergeContainerChunks(chunks: string[]): string[] {
  const merged: string[] = [];
  for (const chunk of chunks) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      shouldMerge(containerKind(previous), containerKind(chunk))
    ) {
      merged[merged.length - 1] = previous + chunk;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

type ContainerKind = "indented" | "list" | "quote" | "standalone";

function containerKind(chunk: string): ContainerKind {
  const first = chunk.split("\n").find((line) => line.trim().length > 0) ?? "";
  if (listItem.test(first)) return "list";
  if (quote.test(first)) return "quote";
  if (indented.test(first)) return "indented";
  return "standalone";
}

function shouldMerge(left: ContainerKind, right: ContainerKind): boolean {
  return (
    (left === "list" && (right === "list" || right === "indented")) ||
    (left === "indented" && right === "indented") ||
    (left === "quote" && right === "quote")
  );
}
