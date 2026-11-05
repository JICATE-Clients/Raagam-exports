/**
 * ONE PASTEL COLOUR FOR EVERY SIDEBAR ICON (user 2026-10-28, "single unified
 * clear colour … pastel", Soft Blue from
 * https://claude.ai/artifact/BYDKZf1nyo1wkvZysgs2Z1). Earlier the same day each
 * module had its own strong colour (option C, "c apply it" — red Production,
 * pink Sample, orange Purchase …); eighteen of them side by side read as noise.
 *
 * Both sidebars set this as `--hue`, and the tiles derive from it: unlit is a
 * 13% pastel tile with the icon in full Soft Blue, lit (the current module in
 * the rail, the current group in the module menu) fills solid with a white
 * icon. Dark mode keeps its own lift in the same classes.
 *
 * It is a single constant on purpose, not a per-module map with equal values:
 * a table nobody reads differently is a table someone "fixes" back into
 * eighteen colours. Changing the sidebar's colour is this one line.
 */
export const SIDEBAR_HUE = "#2F6FB5";

/**
 * ONE COLOUR PER MODULE — THE RAIL AND THE FAVOURITES TILES (user 2026-11-05: "the rails icons
 * also update like same, don't repeat same icon for all", after choosing option C of
 * https://claude.ai/artifact/3MceC5mDQHZQy8DeNQDN3j for Favourites).
 *
 * THIS REVERSES 2026-10-28 FOR THE RAIL, BY REQUEST. That day per-module colours were tried and
 * dropped for the single SIDEBAR_HUE above: strong colours on bare icons, eighteen side by
 * side, "read as noise". What differs now is the SHAPE — each colour is held in a glossy well
 * of identical size and depth with a white glyph (`moduleWellStyle`), the way a phone's app
 * grid carries dozens of colours calmly. SIDEBAR_HUE still colours the module MENU (the second
 * column) and its section tiles; only the rail's icons and the Favourites tiles read this map.
 *
 * Every value is a Tailwind 700/800-depth hue, each clearing 4.5:1 against white — which the
 * white glyph on it needs. Neighbours in the same rail band get neighbouring hues (Sample /
 * Orders, Logistics / Transport); hues that come close (Approvals / Analytics) sit far apart in
 * the rail. A module missing here falls back to SIDEBAR_HUE, so a new module is never blank.
 */
export const MODULE_HUE: Readonly<Record<string, string>> = {
  "/": "#1d4ed8", //                   Dashboard (rail: Home) — blue
  "/favourites": "#a16207", //         Favourites — gold, the star's colour
  "/approvals": "#6d28d9", //          Approvals — violet
  "/sales": "#a21caf", //              Sample — fuchsia
  "/orders": "#be185d", //             Orders — pink
  "/planning": "#0e7490", //           Planning — cyan
  "/purchase": "#037bb8", //           Purchase — the brand sky blue
  "/stores": "#4338ca", //             Stores — indigo
  "/production": "#b91c1c", //         Production — red
  "/logistics": "#0f766e", //          Logistics — teal
  "/logistics/transport": "#047857", // Transport — emerald
  "/hr": "#4d7a12", //                 HR & Payroll — the brand green family
  "/finance": "#7c2d12", //            Finance — rupee brown
  "/analytics": "#7e22ce", //          Analytics — purple
  "/reports": "#475569", //            Reports — slate
  "/comms": "#e11d48", //              Pulse — rose
  "/masters": "#854d0e", //            Master Data — umber
  "/integration": "#155e75", //        Integration — deep cyan
  "/resolve": "#c2410c", //            Help & Repairs — orange
  "/admin": "#374151", //              Administration — graphite
};

/** The colour for a module's nav href (exact match), or the Soft Blue fallback. */
export function moduleHue(href: string): string {
  return MODULE_HUE[href] ?? SIDEBAR_HUE;
}

/**
 * Option C's well: the colour as a light-to-deep gradient with a soft top highlight, the glyph
 * WHITE on it. The one definition — the rail, the Favourites tiles, the Edit sheet and the admin
 * list all call it. `color-mix` derives the light end, so a hue is one value, not two tokens.
 */
export function moduleWellStyle(hue: string): { background: string; color: string; boxShadow: string } {
  return {
    background: `linear-gradient(150deg, color-mix(in srgb, ${hue} 62%, white), ${hue} 70%)`,
    color: "#ffffff",
    boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.45), 0 4px 10px -5px ${hue}`,
  };
}
