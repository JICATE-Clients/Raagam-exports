/**
 * Type scale — a second, INDEPENDENT appearance preference beside the colour
 * theme in `lib/theme.ts`.
 *
 * "standard" is the app's original look. "compact" (the default) is the
 * clean ERP type scale (page title 20/28/600 … helper 11/16/400) defined under
 * `html[data-type-scale="compact"]` in `app/globals.css`. It changes text only —
 * never colour — so it composes with Light, Dark and System rather than being a
 * fourth step in that cycle.
 *
 * No "use client": app/layout.tsx is a server component and needs only the
 * init script string (same reasoning as `lib/theme.ts`).
 */

export type TypeScale = "standard" | "compact";

export const TYPE_SCALE_STORAGE_KEY = "raagam-type-scale";

/** The attribute on <html> that every compact rule in globals.css keys off. */
export const TYPE_SCALE_ATTR = "data-type-scale";

/**
 * Runs inline in <head> before first paint, beside THEME_INIT_SCRIPT, so a
 * compact-text user never sees the standard sizes flash and reflow.
 *
 * COMPACT IS THE DEFAULT (client 2026-09-16, "make it as default view"): the
 * attribute is set unless the operator has explicitly switched to "standard".
 * An absent or unreadable preference therefore means compact — keep
 * DEFAULT_TYPE_SCALE and this script agreeing.
 */
export const DEFAULT_TYPE_SCALE: TypeScale = "compact";

export const TYPE_SCALE_INIT_SCRIPT = `(function(){var s=null;try{s=localStorage.getItem(${JSON.stringify(
  TYPE_SCALE_STORAGE_KEY,
)})}catch(e){}if(s!=="standard")document.documentElement.setAttribute(${JSON.stringify(
  TYPE_SCALE_ATTR,
)},"compact")})()`;

export function isTypeScale(v: unknown): v is TypeScale {
  return v === "standard" || v === "compact";
}
