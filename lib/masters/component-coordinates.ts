/**
 * Which components belong to a coordinate.
 *
 * A component is a PART of a garment — Front Body, Sleeve, Rib — and a
 * coordinate is a SECTION of the style: Top, Bottom, Inner. Front Body belongs
 * to a Top and means nothing under a Bottom, so the Style screen's Components
 * grid narrows its Component cell by the Coordinate cell beside it.
 *
 *
 * WHAT THE SCHEMA ACTUALLY SAYS, AND WHAT THE DATA ACTUALLY HOLDS
 *
 * The relation is declared, in two halves on the Components master (0228):
 *
 *   - `components.all_coordinates` — a boolean, DEFAULT TRUE, meaning "offer me
 *     everywhere";
 *   - `component_coordinates` — a child grid of free-TEXT coordinate labels,
 *     which is what a component that unticked the box lists instead.
 *
 * So this is not a join invented here. It is also, today, a filter that narrows
 * NOTHING, and that is worth stating plainly rather than discovering later: the
 * live database holds 2 components, both `all_coordinates = true`, and one
 * coordinate row between them. The 685-row legacy import (0296) carried the
 * header flags but left the child grid empty on purpose — its own comment says
 * the source report did not include the itemized grid.
 *
 * THAT IS THE DESIGN, NOT A GAP TO PATCH. A no-op filter over the master's own
 * declaration is a filter that starts working the moment an operator unticks
 * "All Coordinates" on a component and lists its sections. The alternative —
 * correlating components to coordinates by some other route to make the filter
 * "do something" now — invents a relation nobody declared, and an invented one
 * hides a component the operator needs with nothing on screen to say why. An
 * unfiltered list is better than a wrong one.
 *
 *
 * THE MATCH IS BY NAME, BECAUSE THE TWO SIDES ARE NOT THE SAME KIND OF THING
 *
 * A style's coordinate is an `items` row of class GAR (0396: "A COORDINATE IS A
 * GARMENT"). The Components master predates that and stores plain text. There is
 * no id to join on, so the comparison is the trimmed, upper-cased name — which
 * is why this takes the coordinate OPTIONS rather than a bare id: the caller
 * already holds them, and resolving the name anywhere else would be a second
 * copy of this rule.
 */

/** What this rule needs off a component. A subset of `Component`
 *  (`./component-types`), declared structurally so a picker row carrying only
 *  these three fields can be filtered without building a full master record. */
export type ComponentScopeRow = {
  id: string;
  /** True = offered under every coordinate. The master's default. */
  all_coordinates: boolean;
  /** The coordinate labels this component declared, verbatim from
   *  `component_coordinates.coordinate`. Normalized here, not by the caller. */
  coordinate_names: string[];
};

/** Trim + upper-case, the one place. `components.short_name` goes through
 *  `capsName()` but `component_coordinates.coordinate` does not (see
 *  `componentCoordinateInput`), so the two sides genuinely can differ in case
 *  and a `===` on the raw strings would match nothing. */
function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

/**
 * Is this component offered under this coordinate name?
 *
 * Exported so the Components master screen can answer the same question the
 * Style screen asks, rather than growing its own version of it.
 *
 * THREE CASES, AND THE THIRD IS THE ONE THAT COSTS DATA IF YOU GET IT WRONG:
 *
 *   - `all_coordinates` → yes, always. The master said so.
 *   - a non-empty list → yes only if it names this coordinate.
 *   - `all_coordinates = false` WITH AN EMPTY LIST → **yes**. This looks like
 *     "restricted to nothing" and reads as a reason to hide it everywhere, which
 *     would make the component unreachable on every screen in the app with no
 *     way to notice. It is a real state in real data: 0296 imported four rows
 *     (LEG, LEG CUFF, BACK LEFT LEG, BACK RIGHT LEG) in exactly it, and named
 *     them, because the legacy report carried the flag but not the grid. A
 *     component that has declared no coordinates has declared no restriction.
 */
export function componentAllowsCoordinate(
  c: ComponentScopeRow,
  coordinateName: string | null | undefined,
): boolean {
  if (c.all_coordinates) return true;
  const declared = c.coordinate_names.map(norm).filter(Boolean);
  if (declared.length === 0) return true;
  const want = norm(coordinateName);
  return !!want && declared.includes(want);
}

/**
 * The components offerable on a row whose Coordinate cell holds `coordinateId`.
 *
 * A BLANK COORDINATE OFFERS EVERYTHING. That is deliberately the opposite of the
 * nominated-vendor rule ("blank supply type → NOTHING, with a line saying to
 * pick the type first"), and the difference is what the empty state means. There,
 * the customer's approval list IS the constraint and a full list leaks vendors
 * they never approved — a compliance failure. Here the coordinate cell is simply
 * unanswered on a row the operator just added, every component in the master is
 * currently offered under every coordinate anyway, and an empty dropdown on a
 * fresh row would read as a broken screen.
 *
 * THE ROW'S EXISTING VALUE ALWAYS SURVIVES (`currentValue`) — the standing
 * "Disabled rows" rule, and the reason is the same one: a component dropped from
 * the list shows a filled cell as empty and blanks the FK on the next save. It
 * is reachable without choosing badly, because the coordinate can move out from
 * under a component that was already right.
 *
 * Order is preserved, so the caller's sort survives.
 */
export function componentsForCoordinate<T extends ComponentScopeRow>(
  components: readonly T[],
  opts: {
    coordinateId: string | null | undefined;
    /** The coordinate options the screen already holds — `items` of class GAR. */
    coordinates: readonly { id: string; name: string }[];
    /** The component this row already holds. Never filtered out. */
    currentValue?: string | null;
  },
): T[] {
  const { coordinateId, coordinates, currentValue } = opts;
  if (!coordinateId) return [...components];

  const name = coordinates.find((c) => c.id === coordinateId)?.name ?? null;
  // An id that resolves to no option is a coordinate this screen cannot name —
  // a since-deleted item, or a list that has not loaded. Narrowing on a name we
  // do not have would empty the dropdown for a reason nothing can explain.
  if (!name) return [...components];

  return components.filter(
    (c) => c.id === currentValue || componentAllowsCoordinate(c, name),
  );
}
