/**
 * The card's second line. Prompts are authored as markdown, so the first line
 * is often a heading — showing its hashes would read as a typo.
 */
export function suggestionSubtitle(prompt: string): string {
  const line = prompt
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value !== "");
  return (line ?? "").replace(/^(?:>\s*)?#{1,6}\s+/u, "").trim();
}
