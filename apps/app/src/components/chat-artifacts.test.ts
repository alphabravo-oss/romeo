import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { renderableContent } from "../lib/chat-citations";
import {
  artifactMarkdown,
  collectArtifacts,
  findArtifactVersion,
  type ArtifactSource,
} from "./chat-artifacts";

function assistant(id: string, content: string): ArtifactSource {
  return { content, id, role: "assistant" };
}

function scannedOffsets(content: string, citationCount = 0): number[] {
  return collectArtifacts([assistant("m1", content)], citationCount)
    .flatMap((artifact) => artifact.versions.map((version) => version.offset))
    .sort((left, right) => left - right);
}

/**
 * What react-markdown reports for the same fences. The scanner's offset is only
 * a block's identity if the renderer agrees with it character for character, and
 * no test of the scanner alone can say whether it does.
 */
function renderedOffsets(content: string): (number | undefined)[] {
  const offsets: (number | undefined)[] = [];
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        components: {
          pre: ({
            children,
            node,
          }: {
            children?: ReactNode;
            node?: unknown;
          }) => {
            offsets.push(
              (
                node as
                  | { position?: { start: { offset?: number } } }
                  | undefined
              )?.position?.start.offset,
            );
            return createElement("pre", undefined, children);
          },
        },
        remarkPlugins: [remarkGfm],
      },
      content,
    ),
  );
  return offsets;
}

const longBody = Array.from({ length: 14 }, (_, line) => `line ${line}`).join(
  "\n",
);

describe("collectArtifacts", () => {
  it("groups revisions of the same filename across turns", () => {
    const artifacts = collectArtifacts([
      assistant(
        "m1",
        `Here you go\n\n\`\`\`ts app/main.ts\n${longBody}\n\`\`\``,
      ),
      { content: "make it faster", id: "m2", role: "user" },
      assistant(
        "m3",
        `Updated\n\n\`\`\`ts app/main.ts\n${longBody}\nextra\n\`\`\``,
      ),
    ]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.key).toBe("app/main.ts");
    expect(artifacts[0]?.title).toBe("app/main.ts");
    expect(artifacts[0]?.versions.map((version) => version.messageId)).toEqual([
      "m1",
      "m3",
    ]);
  });

  // Two questions, two answers, one bare fence each: nothing here says the
  // second script has anything to do with the first, and paging between them
  // as "1 / 2" of one artifact tells the reader it revised something.
  it("never versions blocks the model did not name", () => {
    const artifacts = collectArtifacts([
      assistant("m1", `\`\`\`python\n${longBody}\n\`\`\``),
      { content: "now something unrelated", id: "m2", role: "user" },
      assistant("m3", `\`\`\`python\n${longBody}\nmore\n\`\`\``),
    ]);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.versions.length)).toEqual([
      1, 1,
    ]);
  });

  // A block too short to promote used to leave no gap behind it, so the block
  // after it inherited the slot the next turn's first block would claim.
  it("never versions across turns because a short block was skipped", () => {
    const artifacts = collectArtifacts([
      assistant(
        "m1",
        `\`\`\`python\nprint(1)\n\`\`\`\n\n\`\`\`python\n${longBody}\n\`\`\``,
      ),
      assistant(
        "m2",
        `\`\`\`python\n${longBody}\nfirst\n\`\`\`\n\n\`\`\`python\n${longBody}\nsecond\n\`\`\``,
      ),
    ]);
    expect(artifacts).toHaveLength(3);
    expect(artifacts.every((artifact) => artifact.versions.length === 1)).toBe(
      true,
    );
  });

  it("keeps a second block of the same language in one message apart", () => {
    const content = `\`\`\`python\n${longBody}\n\`\`\`\n\n\`\`\`python\n${longBody}\n\`\`\``;
    const artifacts = collectArtifacts([assistant("m1", content)]);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.versions[0]?.offset)).toEqual([
      0,
      content.lastIndexOf("```python"),
    ]);
  });

  it("does not group unrelated blocks", () => {
    const artifacts = collectArtifacts([
      assistant("m1", `\`\`\`ts app/main.ts\n${longBody}\n\`\`\``),
      assistant("m2", `\`\`\`ts app/other.ts\n${longBody}\n\`\`\``),
      assistant("m3", `\`\`\`sql\n${longBody}\n\`\`\``),
    ]);
    expect(artifacts.map((artifact) => artifact.title)).toEqual([
      "app/main.ts",
      "app/other.ts",
      "sql",
    ]);
    expect(artifacts.map((artifact) => artifact.versions.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("excludes short prose-sized blocks but never a diagram", () => {
    const artifacts = collectArtifacts([
      assistant(
        "m1",
        "```sh\nnpm install\n```\n\n```mermaid\ngraph TD;\nA-->B;\n```",
      ),
    ]);
    expect(artifacts.map((artifact) => artifact.title)).toEqual(["mermaid"]);
  });

  it("ignores code a person pasted", () => {
    expect(
      collectArtifacts([
        {
          content: `\`\`\`ts app/main.ts\n${longBody}\n\`\`\``,
          id: "m1",
          role: "user",
        },
      ]),
    ).toEqual([]);
  });

  it("reads a filename out of a title attribute", () => {
    const artifacts = collectArtifacts([
      assistant("m1", `\`\`\`python title="solver.py"\n${longBody}\n\`\`\``),
    ]);
    expect(artifacts[0]?.key).toBe("solver.py");
    expect(artifacts[0]?.language).toBe("python");
  });

  it("keeps the partial code of a fence that is still streaming", () => {
    const artifacts = collectArtifacts([
      assistant("m1", `Writing it now\n\n\`\`\`ts app/main.ts\n${longBody}`),
    ]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.versions[0]?.code).toBe(longBody);
  });

  it("points the offset at the first fence character", () => {
    const tilde = `intro\n\n~~~python\n${longBody}\n~~~`;
    expect(
      collectArtifacts([assistant("m1", tilde)])[0]?.versions[0]?.offset,
    ).toBe(tilde.indexOf("~~~"));

    const nested = `\`\`\`\`md app/readme.md\n\`\`\`ts\nx\n\`\`\`\n${longBody}\n\`\`\`\``;
    const nestedArtifacts = collectArtifacts([assistant("m1", nested)]);
    expect(nestedArtifacts[0]?.key).toBe("app/readme.md");
    expect(nestedArtifacts[0]?.versions[0]?.offset).toBe(0);

    const listed = `- step\n\n  \`\`\`ts app/main.ts\n${longBody}\n  \`\`\``;
    expect(
      collectArtifacts([assistant("m1", listed)])[0]?.versions[0]?.offset,
    ).toBe(listed.indexOf("```"));
  });
});

describe("findArtifactVersion", () => {
  const artifacts = collectArtifacts([
    assistant("m1", `\`\`\`ts app/main.ts\n${longBody}\n\`\`\``),
    assistant("m2", `\`\`\`ts app/main.ts\n${longBody}\nmore\n\`\`\``),
  ]);

  it("resolves a rendered block to its revision", () => {
    expect(findArtifactVersion(artifacts, "m2", 0)).toEqual({
      key: "app/main.ts",
      total: 2,
      version: 1,
    });
  });

  it("resolves nothing for a block it did not collect", () => {
    expect(findArtifactVersion(artifacts, "m2", 4)).toBeUndefined();
    expect(findArtifactVersion(artifacts, "m9", 0)).toBeUndefined();
  });
});

describe("offsets the renderer agrees with", () => {
  it("agrees on plain content", () => {
    const content = `intro\n\n\`\`\`ts app/main.ts\n${longBody}\n\`\`\`\n\ntail\n\n~~~python\n${longBody}\n~~~\n`;
    expect(scannedOffsets(content)).toEqual(renderedOffsets(content));
  });

  it("agrees on a list-indented fence", () => {
    const indented = longBody.split("\n").join("\n  ");
    const content = `- step one\n\n  \`\`\`ts app/main.ts\n  ${indented}\n  \`\`\`\n`;
    expect(scannedOffsets(content)).toEqual(renderedOffsets(content));
  });

  it("agrees only once inline citation markers have been inserted", () => {
    const raw = `As shown [1] and [2].\n\n\`\`\`ts app/main.ts\n${longBody}\n\`\`\`\n\nCitations:\n- [1] one\n- [2] two\n`;
    expect(scannedOffsets(raw, 2)).toEqual(
      renderedOffsets(renderableContent(raw, 2)),
    );
    // Ignoring the citations is the trap: every marker before a fence moves it,
    // so the block would be addressed by an offset nothing renders at.
    expect(scannedOffsets(raw, 0)).not.toEqual(scannedOffsets(raw, 2));
  });

  it("counts a message's own citations before the chat's", () => {
    const raw = `As shown [1].\n\n\`\`\`ts app/main.ts\n${longBody}\n\`\`\``;
    const artifacts = collectArtifacts(
      [{ ...assistant("m1", raw), citations: { length: 1 } }],
      0,
    );
    expect(artifacts[0]?.versions[0]?.offset).toBe(
      renderableContent(raw, 1).indexOf("```"),
    );
  });
});

/**
 * A delta rebuilds one message and leaves every other row the same object, so
 * that is what a repeat scan can be recognised by. Nothing here is an
 * optimisation detail: the list is handed to a React context, which reaches
 * past every memo between it and the code blocks reading it, so a list that
 * changes identity per token re-renders the whole transcript per token.
 */
describe("scanning a streaming conversation again", () => {
  const settled = assistant("m1", `\`\`\`ts app/main.ts\n${longBody}\n\`\`\``);

  it("hands back the same list while the new answer has no block yet", () => {
    const first = collectArtifacts([settled, assistant("m2", "working on it")]);
    const second = collectArtifacts([
      settled,
      assistant("m2", "working on it, one moment"),
    ]);
    expect(second).toBe(first);
  });

  it("rescans only the message the delta touched", () => {
    const before = collectArtifacts([
      settled,
      assistant("m2", `\`\`\`python\n${longBody}\n\`\`\``),
    ]);
    const after = collectArtifacts([
      settled,
      assistant("m2", `\`\`\`python\n${longBody}\nmore\n\`\`\``),
    ]);
    expect(after).not.toBe(before);
    expect(after[1]?.versions[0]?.code).toBe(`${longBody}\nmore`);
    // Same version object: the settled message was not read a second time.
    expect(after[0]?.versions[0]).toBe(before[0]?.versions[0]);
  });
});

describe("artifactMarkdown", () => {
  it("round-trips a version through a fence the code cannot close", () => {
    expect(
      artifactMarkdown({
        code: "before\n```\ninner\n```\nafter",
        language: "md",
        messageId: "m1",
        offset: 0,
      }),
    ).toBe("````md\nbefore\n```\ninner\n```\nafter\n````");
  });

  it("uses a plain fence for ordinary code", () => {
    expect(
      artifactMarkdown({
        code: "const a = 1;",
        language: "ts",
        messageId: "m1",
        offset: 0,
      }),
    ).toBe("```ts\nconst a = 1;\n```");
  });
});
