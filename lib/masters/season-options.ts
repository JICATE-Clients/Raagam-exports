/**
 * ONE SEASON LIST FOR ORDERS AND SAMPLE (0717, user 2026-10-12) — the Season
 * master's names, which every Season box offers. Client-safe and pure.
 *
 * A saved season is TEXT on the order / style rows, and rows saved before the
 * capitals rule hold "Summer" where the master says SUMMER. So the box matches
 * the held value case-insensitively and shows the master's spelling; a held
 * value the master does not list at all ("SS26", imported free text) stays as
 * its own option — a <select> with no option for its value silently reads
 * blank, and the next Save would blank the column (AGENTS.md "Disabled rows").
 */
export function seasonChoice(names: readonly string[], held: string | null | undefined): { options: string[]; value: string } {
  const raw = (held ?? "").trim();
  const hit = names.find((n) => n.toUpperCase() === raw.toUpperCase());
  return {
    options: hit || !raw ? [...names] : [...names, raw],
    value: hit ?? raw,
  };
}
