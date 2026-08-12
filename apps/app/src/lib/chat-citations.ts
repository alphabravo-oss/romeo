// Retrieval-grounded answers arrive with a "Citations:" block appended by the
// server (packages/core/src/services/run-knowledge.ts appendRunCitations) and
// with bracket numbers left in the prose by the model, which the same prompt
// asked for. The footer duplicates CitationList, and a bare "[3]" tells the
// reader nothing. These two passes move the source to the point of use.

// Mirrors run-knowledge.ts's runCitationFooter so it can only ever match what
// the server wrote: a title containing a newline simply fails to match and the
// footer stays visible rather than eating real answer text.
const citationFooter = /\n\nCitations:\n(?:- \[\d+\][^\n]*\n?)+\s*$/u;

const fenceOpener = /^ {0,3}(`{3,}|~{3,})/u;

// Not a link target, a reference-style link, and not already followed by a
// URL: "[3](https://…)" and "[3][ref]" are the model's own markdown.
const citationMarker = /\[(\d+)\](?![([:])/gu;

// A fragment rather than a custom scheme: react-markdown's default
// urlTransform rewrites any protocol outside http/https/mailto/xmpp to the
// empty string, so "romeo-citation:0" would reach the renderer with no href
// at all and every marker would fall through to a plain link.
export const citationHrefPrefix = "#romeo-citation-";

export function stripCitationFooter(content: string): string {
  return content.replace(citationFooter, "");
}

/**
 * The exact string the renderer parses. Shared rather than inlined because a
 * marker inserted into the prose shifts every character offset after it, and a
 * fenced block's offset is the identity the canvas pane binds to: whoever needs
 * to reason about where a block sits has to be looking at this string.
 */
export function renderableContent(
  content: string,
  citationCount: number,
): string {
  return citationCount === 0
    ? content
    : linkCitationMarkers(stripCitationFooter(content), citationCount);
}

/**
 * Rewrites in-prose "[3]" into a link the renderer turns into a superscript
 * marker. Out-of-range numbers stay verbatim -- a model writing "[2024]" or
 * citing a source that was trimmed from the prompt must not produce a marker
 * that points nowhere.
 *
 * ponytail: line-oriented, so it skips fenced blocks and inline code spans but
 * not indented (four-space) code blocks or HTML blocks -- a "[1]" in one still
 * links. Upgrade path: a remark plugin, which sees the parsed tree and cannot
 * be fooled by any block type.
 */
export function linkCitationMarkers(content: string, count: number): string {
  if (count <= 0) return content;
  let fence: string | undefined;
  return content
    .split("\n")
    .map((line) => {
      const opener = fenceOpener.exec(line)?.[1];
      if (fence !== undefined) {
        if (
          opener !== undefined &&
          opener[0] === fence[0] &&
          opener.length >= fence.length
        ) {
          fence = undefined;
        }
        return line;
      }
      if (opener !== undefined) {
        fence = opener;
        return line;
      }
      return linkLine(line, count);
    })
    .join("\n");
}

function linkLine(line: string, count: number): string {
  // Odd segments are inline code spans, which are content and not prose.
  return line
    .split(/(`+[^`]*`+)/u)
    .map((segment, index) =>
      index % 2 === 1 ? segment : linkSegment(segment, count),
    )
    .join("");
}

function linkSegment(segment: string, count: number): string {
  return segment.replace(citationMarker, (match, digits: string) => {
    const number = Number(digits);
    return number >= 1 && number <= count
      ? `[${digits}](${citationHrefPrefix}${number - 1})`
      : match;
  });
}
