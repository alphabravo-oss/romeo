/// <reference types="vite/client" />
import {
  ClientOnly,
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { ToastViewport } from "@romeo/ui";

import { AppProviders } from "../providers/AppProviders";
import { CommandPalette } from "../components/CommandPalette";
import { ShortcutsModal } from "../components/ShortcutsModal";
import { themeInitScript, watchSystemTheme } from "../lib/theme";
import { LocaleProvider } from "../lib/i18n";
import appCss from "../styles/app.css?url";

const romeoIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%233b82f6'/%3E%3Cstop offset='1' stop-color='%237c3aed'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='24' height='24' rx='5' fill='url(%23g)'/%3E%3Cg transform='translate(2.4 2.4) scale(0.8)' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 6V2H8'/%3E%3Cpath d='M15 11v2'/%3E%3Cpath d='M2 12h2'/%3E%3Cpath d='M20 12h2'/%3E%3Cpath d='M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z'/%3E%3Cpath d='M9 11v2'/%3E%3C/g%3E%3C/svg%3E";

const DevUiGallery = import.meta.env.DEV
  ? lazy(() => import("../dev/UiGallery"))
  : null;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      /* Was a single hardcoded #ffffff, which painted a white status bar and
         URL bar around an app that defaults to dark. These must track
         --rm-bg in each scheme. */
      {
        name: "theme-color",
        content: "#ffffff",
        media: "(prefers-color-scheme: light)",
      },
      {
        name: "theme-color",
        content: "#09090b",
        media: "(prefers-color-scheme: dark)",
      },
      { title: "Romeo" },
      {
        name: "description",
        content: "Romeo is a secure AI workspace platform.",
      },
    ],
    links: [
      { rel: "icon", href: romeoIcon },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  component: RootRoute,
});

function RootRoute() {
  const pathname = useLocation({ select: (location) => location.pathname });
  useEffect(() => watchSystemTheme(), []);
  if (DevUiGallery && pathname === "/ui") {
    return (
      <Suspense fallback={null}>
        <DevUiGallery />
      </Suspense>
    );
  }
  return (
    <ClientOnly fallback={<div className="rm-empty">Loading…</div>}>
      <LocaleProvider>
        <Suspense fallback={<div className="rm-empty">Loading…</div>}>
          <AppProviders>
            <Outlet />
            <CommandPalette />
            <ShortcutsModal />
            <ToastViewport />
          </AppProviders>
        </Suspense>
      </LocaleProvider>
    </ClientOnly>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem('romeo:locale');if(l)document.documentElement.lang=l;var p=JSON.parse(localStorage.getItem('romeo:interface')||'{}');document.documentElement.dataset.density=p.density||'comfortable';document.documentElement.dataset.fontSize=p.fontSize||'medium';if(p.reducedMotion)document.documentElement.classList.add('reduce-motion')}catch(e){}})()`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
