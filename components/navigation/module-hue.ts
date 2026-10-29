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
