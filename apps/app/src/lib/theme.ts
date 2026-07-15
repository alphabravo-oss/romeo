export type Theme = "system" | "light" | "dark";

const DARK_META = "#08090a";
const LIGHT_META = "#ffffff";

export function getStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const t = localStorage.theme;
  return t === "light" || t === "dark" || t === "system" ? t : "system";
}

/** Resolve + apply a theme to <html> and the theme-color meta tag. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? DARK_META : LIGHT_META);
}

export function setTheme(theme: Theme): void {
  localStorage.theme = theme;
  applyTheme(theme);
}

// Inlined into <head> before hydration to avoid a flash of the wrong theme.
// Mirrors applyTheme for the very first paint. Keep in sync with the above.
export const themeInitScript = `(function(){try{var t=localStorage.theme;if(t!=='light'&&t!=='dark'&&t!=='system'){t='system';localStorage.theme='system';}var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.add(d?'dark':'light');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?'${DARK_META}':'${LIGHT_META}');}catch(e){}})();`;
