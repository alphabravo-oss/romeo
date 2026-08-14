import { useEffect, useState } from "react";

import { useLocale } from "../lib/i18n";
import { useTranscriptRowVisibility } from "./transcript-row-visibility";

export function MermaidPreview({ code }: { code: string }) {
  const { t } = useLocale();
  const visible = useTranscriptRowVisibility();
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        const result = await mermaid.render(
          `rm-mermaid-${crypto.randomUUID()}`,
          code,
        );
        if (active) setSvg(result.svg);
      })
      .catch(() => {
        if (active) setError(t("diagramError"));
      });
    return () => {
      active = false;
    };
  }, [code, t, visible]);

  if (error) return <div className="rm-code-preview-error">{error}</div>;
  if (!visible || !svg)
    return <div className="rm-code-preview-loading">{t("diagramLoading")}</div>;
  return (
    <div
      className="rm-mermaid-preview"
      // Strict mode sanitizes generated SVG and disables HTML labels.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
