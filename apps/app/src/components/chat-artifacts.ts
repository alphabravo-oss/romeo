/**
 * Long code and diagrams are the one thing in a transcript a reader comes back
 * to, and the transcript is the worst place to keep them: every rewrite pushes
 * the previous revision further up a scroll container that is also moving. This
 * groups every revision of the same file into one artifact the canvas pane can
 * page through.
 *
 * The scan runs over raw markdown rather than the rendered tree because
 * remark-rehype throws the fence info string away, and the filename in that
 * info string is the only durable identity a model gives a file it rewrites.
 */
import { renderableContent } from "../lib/chat-citations";

/** Below this a block is quicker to read where it already is. */
const minimumArtifactLines = 12;

const fencePattern = /^( {0,3})(`{3,}|~{3,})(.*)$/u;
const filenamePattern = /^[\w./@-]*[\w-]\.[A-Za-z0-9]{1,10}$/u;
const filenameAttributePattern =
  /\b(?:file|filename|title)\s*=\s*"?([^"\s]+)"?/iu;

export interface ArtifactSource {
  id: string;
  role: string;
  content: string;
  /**
   * Only the count is read, and only to rebuild the exact string the transcript
   * row renders. Structural rather than the citation type itself so a message
   * straight out of the query cache is already an ArtifactSource, which is what
   * lets the scan cache below key on the message object.
   */
  citations?: { length: number };
}

export interface ArtifactVersion {
  /** Identity of the rendered block, matching hast's `position.start.offset`. */
  messageId: string;
  offset: number;
  language: string;
  code: string;
}

export interface ChatArtifact {
  key: string;
  title: string;
  language: string;
  versions: ArtifactVersion[];
}

export interface ArtifactPlacement {
  key: string;
  version: number;
  total: number;
}

/** One fenced block, already carrying the artifact it belongs to. */
interface ArtifactEntry {
  key: string;
  language: string;
  title: string;
  version: ArtifactVersion;
}

/**
 * What each message contributed, keyed on the message OBJECT rather than its id.
 * The query cache rebuilds only the row a delta touched and hands back the same
 * object for every other message, so identity here means exactly "unchanged
 * since the last token" -- which is what stops a 20-turn transcript being
 * re-prepared and re-scanned sixty times a second while one answer streams.
 * Weak, so a chat the reader has left is collected along with its messages.
 */
const scans = new WeakMap<
  ArtifactSource,
  { citationCount: number; entries: readonly ArtifactEntry[] }
>();

/** Shared, so "this message has no blocks" compares equal between renders. */
const noEntries: readonly ArtifactEntry[] = [];

/** The last grouping, handed back whole when no message's blocks changed. */
let lastGrouping:
  | {
      artifacts: ChatArtifact[];
      entries: readonly (readonly ArtifactEntry[])[];
    }
  | undefined;

/**
 * Messages must arrive in the order the reader sees them -- the active branch,
 * not every message in the chat -- because that order IS the version order.
 * Flipping the "‹ 2 / 3 ›" variant picker therefore rewrites the version list
 * for free, which is correct: a revision on a branch nobody is reading is not a
 * revision of the answer on screen.
 *
 * `citationCount` is the chat-wide fallback for a message that carries none of
 * its own; it decides how many "[3]" markers become links, and every marker
 * before a fence moves that fence, so it is part of a block's identity.
 *
 * Both caches are transparent -- the result always equals what an uncached call
 * would return, and only its IDENTITY is reused. That identity is load-bearing:
 * the caller hands this list to a React context, and a context value ignores
 * every memo boundary between it and the code blocks reading it.
 */
export function collectArtifacts(
  messages: readonly ArtifactSource[],
  citationCount = 0,
): ChatArtifact[] {
  const entries = messages.map((message) =>
    scanMessage(message, message.citations?.length ?? citationCount),
  );
  if (
    lastGrouping !== undefined &&
    sameEntries(lastGrouping.entries, entries)
  ) {
    return lastGrouping.artifacts;
  }
  const artifacts = groupVersions(entries);
  lastGrouping = { artifacts, entries };
  return artifacts;
}

function scanMessage(
  message: ArtifactSource,
  citationCount: number,
): readonly ArtifactEntry[] {
  const cached = scans.get(message);
  if (cached !== undefined && cached.citationCount === citationCount) {
    return cached.entries;
  }
  const entries = scanBlocks(message, citationCount);
  scans.set(message, { citationCount, entries });
  return entries;
}

/**
 * ponytail: only a NAMED file is versioned. Two unnamed blocks are two
 * artifacts, however plainly the second is a rewrite of the first, because the
 * key that used to group them -- the language, counted per message -- said
 * nothing about what the block contained: two unrelated questions each answered
 * with a bare python fence both landed on "python#0" and the pane paged between
 * them as "‹ 1 / 2 ›", claiming a revision history that never happened.
 * CEILING: a model that rewrites a script it never names gets a fresh entry per
 * turn and no version picker. UPGRADE PATH: ask for a filename in the system
 * prompt, which turns every such rewrite into the named case that already
 * works; failing that, group on a signature of the code itself (the first
 * declaration, an import list) rather than on where the block happened to sit.
 */
function scanBlocks(
  message: ArtifactSource,
  citationCount: number,
): readonly ArtifactEntry[] {
  if (message.role !== "assistant" || !hasFencedBlock(message.content)) {
    return noEntries;
  }
  // The string the row renders, not the one the server sent: an inline citation
  // marker shifts every offset after it, and the offset is a block's identity.
  const content = renderableContent(message.content, citationCount);
  const entries: ArtifactEntry[] = [];
  let unnamed = 0;
  for (const block of fencedBlocks(content)) {
    const { filename, language } = describeFence(block.info);
    if (
      language !== "mermaid" &&
      lineCount(block.code) < minimumArtifactLines
    ) {
      continue;
    }
    const key = filename?.toLowerCase() ?? `${message.id}#${unnamed}`;
    if (filename === undefined) unnamed += 1;
    entries.push({
      key,
      language,
      title: filename ?? language,
      version: {
        code: block.code,
        language,
        messageId: message.id,
        offset: block.offset,
      },
    });
  }
  return entries.length === 0 ? noEntries : entries;
}

function sameEntries(
  previous: readonly (readonly ArtifactEntry[])[],
  next: readonly (readonly ArtifactEntry[])[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((entries, index) => entries === next[index])
  );
}

function groupVersions(
  perMessage: readonly (readonly ArtifactEntry[])[],
): ChatArtifact[] {
  const byKey = new Map<string, ChatArtifact>();
  for (const entries of perMessage) {
    for (const entry of entries) {
      const existing = byKey.get(entry.key);
      if (existing === undefined) {
        byKey.set(entry.key, {
          key: entry.key,
          language: entry.language,
          title: entry.title,
          versions: [entry.version],
        });
      } else {
        existing.versions.push(entry.version);
      }
    }
  }
  return [...byKey.values()];
}

/** The early-out: most messages are prose, and so is most of a streaming one. */
function hasFencedBlock(content: string): boolean {
  return content.includes("```") || content.includes("~~~");
}

/** Which artifact and revision a rendered block is, or undefined if it is not one. */
export function findArtifactVersion(
  artifacts: readonly ChatArtifact[],
  messageId: string,
  offset: number,
): ArtifactPlacement | undefined {
  for (const artifact of artifacts) {
    const version = artifact.versions.findIndex(
      (candidate) =>
        candidate.messageId === messageId && candidate.offset === offset,
    );
    if (version !== -1) {
      return { key: artifact.key, total: artifact.versions.length, version };
    }
  }
  return undefined;
}

/**
 * Back into markdown, so the pane renders through the same lazy
 * rehype-highlight / mermaid / copy / download pipeline as the transcript
 * rather than a second, drifting copy of it.
 */
export function artifactMarkdown(version: ArtifactVersion): string {
  const runs = [...version.code.matchAll(/`+/gu)].map(
    (match) => match[0].length,
  );
  const fence = "`".repeat(Math.max(3, Math.max(0, ...runs) + 1));
  return `${fence}${version.language}\n${version.code}\n${fence}`;
}

interface FencedBlock {
  offset: number;
  info: string;
  code: string;
}

/**
 * ponytail: a hand-rolled scanner rather than a markdown parse, so a fence
 * inside an HTML block or a blockquote is read as a fence. The ceiling is a
 * spurious or missing artifact, never a crash or a wrong version -- the block
 * key is an exact offset match, so a block the scanner and the renderer
 * disagree about simply gets no button. Upgrade path: a remark plugin that
 * stamps `code.meta` onto the hast node, which removes the second scan entirely.
 */
function fencedBlocks(content: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let open:
    | { indent: number; info: string; marker: string; offset: number }
    | undefined;
  let body: string[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    const match = fencePattern.exec(line);
    const indent = match?.[1] ?? "";
    const marker = match?.[2] ?? "";
    const rest = match?.[3] ?? "";
    if (open === undefined) {
      // A backtick in the info string opens nothing: CommonMark reserves it so
      // an inline span like ``a`` cannot be mistaken for a fence.
      if (match !== null && !(marker.startsWith("`") && rest.includes("`"))) {
        open = {
          indent: indent.length,
          info: rest.trim(),
          marker,
          offset: offset + indent.length,
        };
        body = [];
      }
    } else if (
      match !== null &&
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length &&
      rest.trim() === ""
    ) {
      blocks.push({
        code: body.join("\n"),
        info: open.info,
        offset: open.offset,
      });
      open = undefined;
    } else {
      body.push(line.slice(Math.min(open.indent, leadingSpaces(line))));
    }
    offset += line.length + 1;
  }
  // An unterminated fence is the block the model is still writing, and the
  // canvas is most useful while that is happening.
  if (open !== undefined) {
    blocks.push({
      code: body.join("\n"),
      info: open.info,
      offset: open.offset,
    });
  }
  return blocks;
}

function describeFence(info: string): {
  filename: string | undefined;
  language: string;
} {
  const tokens = info.split(/\s+/u).filter((token) => token.length > 0);
  const first = tokens[0];
  const leadingFilename =
    first !== undefined && filenamePattern.test(first) ? first : undefined;
  const filename =
    filenameAttributePattern.exec(info)?.[1] ??
    leadingFilename ??
    tokens.slice(1).find((token) => filenamePattern.test(token));
  const language = (
    leadingFilename === undefined ? first : extensionOf(leadingFilename)
  )?.toLowerCase();
  return {
    filename,
    language: language === undefined || language === "" ? "text" : language,
  };
}

function extensionOf(filename: string): string {
  return filename.slice(filename.lastIndexOf(".") + 1);
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function lineCount(code: string): number {
  return code.split("\n").length;
}
