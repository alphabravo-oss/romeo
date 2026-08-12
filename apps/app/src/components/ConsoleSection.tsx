import type { ReactNode } from "react";

/**
 * The one section contract for every console surface (Admin, Workspace,
 * Settings).
 *
 * Before this existed the console had 90 distinct page-root structures and 8
 * different ways of rendering a section title, and the global stylesheet spent
 * a dozen rules trying to normalise them after the fact — flattening
 * `.rm-panel`, stripping borders off `.rounded-md`, re-typing bare Tailwind
 * headings. Those rules could only ever catch the shapes they already knew
 * about, so every new panel drifted again.
 *
 * A section owns its heading, its optional description, its action slot, and
 * the vertical rhythm between itself and its neighbours. Panels supply content
 * and nothing else.
 *
 *   <ConsoleSection
 *     title={t("providerCredentials")}
 *     description={t("connectionsDescription")}
 *     actions={<AddButton onClick={open}>{t("addProvider")}</AddButton>}
 *   >
 *     <DataTable … />
 *   </ConsoleSection>
 *
 * Omit `title` for a section that is pure content — a table the page header
 * already names. The rhythm still applies, and no second heading competes with
 * the page title.
 */
export function ConsoleSection({
  actions,
  children,
  description,
  id,
  title,
  tone = "default",
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  id?: string;
  title?: ReactNode;
  /** `danger` separates destructive controls from routine settings. */
  tone?: "danger" | "default";
}): ReactNode {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section
      className={`rm-section${tone === "danger" ? " rm-section--danger" : ""}`}
      id={id}
    >
      {hasHeader ? (
        <header className="rm-section__head">
          <div className="rm-section__copy">
            {title === undefined ? null : (
              <h3 className="rm-section__title">{title}</h3>
            )}
            {description === undefined ? null : (
              <p className="rm-section__description">{description}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="rm-section__actions">{actions}</div>
          )}
        </header>
      ) : null}
      <div className="rm-section__body">{children}</div>
    </section>
  );
}
