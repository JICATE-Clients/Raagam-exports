/**
 * Theme constants shared by the server layout and the client toggle.
 *
 * Deliberately has no "use client" directive: app/layout.tsx is a server
 * component and only needs the init script string, so putting these here keeps
 * it from pulling the toggle's client module into the server graph.
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "raagam-theme";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs inline in <head>, before first paint.
 *
 * React cannot do this job: the first paint happens before hydration, so the
 * `.dark` class has to already be on <html> or dark-mode users get a white
 * flash on every load. Built from the constants above so the storage key can
 * never drift from the one the toggle writes.
 *
 * try/catch because localStorage throws outright in some privacy modes, and a
 * theme preference is not worth breaking the page over.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="dark"||((!t||t==="system")&&window.matchMedia(${JSON.stringify(
  DARK_QUERY,
)}).matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}
