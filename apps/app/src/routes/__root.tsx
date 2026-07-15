/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppProviders } from "../providers/AppProviders";
import { CommandPalette } from "../components/CommandPalette";
import { ShortcutsModal } from "../components/ShortcutsModal";
import { Toaster } from "../components/Toaster";
import { themeInitScript } from "../lib/theme";
import appCss from "../styles/app.css?url";

const romeoIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%235e6ad2'/%3E%3Cg transform='translate(2.4 2.4) scale(0.8)' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 6V2H8'/%3E%3Cpath d='M15 11v2'/%3E%3Cpath d='M2 12h2'/%3E%3Cpath d='M20 12h2'/%3E%3Cpath d='M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z'/%3E%3Cpath d='M9 11v2'/%3E%3C/g%3E%3C/svg%3E";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#ffffff" },
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
  return (
    <AppProviders>
      <Outlet />
      <CommandPalette />
      <ShortcutsModal />
      <Toaster />
    </AppProviders>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
