import { Button } from "@romeo/ui";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert.mjs";

import { useLocale } from "../lib/i18n";

/**
 * Rendered by the router whenever a route's component or loader throws.
 *
 * Wired as `defaultErrorComponent` in router.tsx rather than per route, so a
 * newly added route cannot ship without a boundary. Note this catches render
 * and loader failures only — React boundaries have never caught throws inside
 * event handlers or detached promises, which still need try/catch at the call
 * site.
 */
export function RouteErrorBoundary({ error, reset }: ErrorComponentProps) {
  const { t } = useLocale();
  return (
    <div className="rm-route-error" role="alert">
      <div className="rm-route-error-icon">
        <TriangleAlert aria-hidden="true" size={22} />
      </div>
      <h1 className="rm-route-error-title">{t("somethingWentWrong")}</h1>
      <p className="rm-route-error-body">{t("errorBoundaryBody")}</p>
      <div className="rm-route-error-actions">
        <Button className="primary" onClick={reset} type="button">
          <RefreshCw aria-hidden="true" size={15} />
          {t("tryAgain")}
        </Button>
        <Button onClick={() => window.location.reload()} type="button">
          {t("reloadPage")}
        </Button>
      </div>
      {/* ponytail: dev-only stack. In production the message can carry
          server-side detail, so it stays out of the DOM entirely rather than
          being merely visually hidden. Upgrade path when real observability
          lands: surface a correlation id here instead of the stack. */}
      {import.meta.env.DEV ? (
        <details className="rm-route-error-details">
          <summary>{t("errorDetails")}</summary>
          <pre>{error.stack ?? error.message}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** Rendered for unmatched routes and for loaders that throw `notFound()`. */
export function RouteNotFound() {
  const { t } = useLocale();
  return (
    <div className="rm-route-error" role="alert">
      <div className="rm-route-error-icon">
        <TriangleAlert aria-hidden="true" size={22} />
      </div>
      <h1 className="rm-route-error-title">{t("pageNotFound")}</h1>
      <p className="rm-route-error-body">{t("pageNotFoundBody")}</p>
      <div className="rm-route-error-actions">
        <Link className="rm-ui-button primary" to="/">
          {t("backToChat")}
        </Link>
      </div>
    </div>
  );
}
