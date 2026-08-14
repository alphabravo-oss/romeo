import type { ReactNode } from "react";

/**
 * The first column of an inventory: what the row *is*.
 *
 * A monogram plus a two-line name/detail stack gives every grid the same
 * anchor, so rows scan vertically instead of each table inventing its own
 * arrangement of bold text and muted subtitles.
 *
 *   <IdentityCell primary={user.name} secondary={user.email} mono />
 *
 * `initials` defaults to the first letters of `primary`; pass it explicitly
 * when the source has a better short form (a provider's type, say).
 */
export function IdentityCell({
  initials,
  mono = false,
  primary,
  secondary,
}: {
  initials?: string;
  /** Render the detail line in the mono role — endpoints, ids, slugs. */
  mono?: boolean;
  primary: ReactNode;
  secondary?: ReactNode;
}): ReactNode {
  const monogram =
    initials ?? (typeof primary === "string" ? monogramOf(primary) : "•");
  return (
    <div className="rm-identity">
      <span aria-hidden="true" className="rm-identity__mark">
        {monogram}
      </span>
      <span className="rm-identity__copy">
        <span className="rm-identity__primary">{primary}</span>
        {secondary === undefined ? null : (
          <span
            className={`rm-identity__secondary${mono ? " is-mono" : ""}`}
            translate={mono ? "no" : undefined}
          >
            {secondary}
          </span>
        )}
      </span>
    </div>
  );
}

/** First letters of the first two words, e.g. "Dana Whitfield" -> "DW". */
function monogramOf(value: string): string {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "•";
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  return letters.join("").toUpperCase();
}
