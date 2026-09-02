"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { useRequiredHold } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { GRID_FRAME } from "@/components/masters/child-grid";
import { cn } from "@/lib/utils";

/**
 * PICK SEVERAL FROM ONE LIST — the app's first multi-select.
 *
 * WHY A NEW PRIMITIVE RATHER THAN A MODE ON `DataPicker`. Multi-select is a
 * genuinely different control: the list stays open across picks, Enter toggles
 * instead of committing, and the chosen values need somewhere to live that is
 * not the trigger. Threading that through `DataPicker` means a second behaviour
 * for `value`, `onChange`, `usedIds`, `blockedReason` and the whole Enter path,
 * across ~160 call sites that all want the single-select one. This owes those
 * call sites nothing and can be read on its own.
 *
 * WHAT IT STILL OWES THE CONTRACTS, because a hand-rolled control inherits none
 * of it (AGENTS.md, "A raw lowercase element is where this rule leaks"):
 *
 *   - **The keyboard contract.** The trigger is a real `<input>` carrying
 *     `data-field-trigger`, so `isFieldLike` counts it as a field and Tab, the
 *     arrows and Enter-advance route off the marker exactly as they do for a
 *     picker. Closed: ↓ opens. Open: ↑/↓ move the highlight, Enter and Space
 *     toggle, Esc closes — the `keyFills` branches, which is what lets this sit
 *     in a mandatory field without caging the operator.
 *   - **Escape calls preventDefault.** Anything consuming Escape must, or the
 *     page-level handler in `keyboard-nav-provider.tsx` navigates away behind it.
 *   - **Browser autofill is off**, with the password-manager opt-outs beside it:
 *     the managers ignore `autocomplete` and read only their own markers, and a
 *     remembered-values popup would eat the ↓ that opens this list.
 *   - **Disabled rows are gone, not greyed** — except one the record already
 *     holds, which stays visible and tagged so a stored value never silently
 *     disappears from a field that is showing it.
 *
 * `data-field-empty` is declared, so a `ChildGrid` row ending in an empty one of
 * these declines Enter instead of spawning a blank row.
 */
/** The synthetic "+ Add" row's id — never a real option id. */
const CREATE_ID = "__multiselect_create__";

/**
 * THE WRAPPING TRACK FOR `gridded`, AND WHY IT IS 6.5rem RATHER THAN `GRID_COMPACT`.
 *
 * `child-grid.tsx` declares `GRID_COMPACT` at `repeat(auto-fill, 9rem)` and it was
 * written for this very data — the Style master's size list, 2026-08-18, "nine
 * sizes to a line where the fractional track fitted six". The obvious move is to
 * import it, the way `GRID_FRAME` is imported above, so the two cannot drift.
 *
 * They should drift, because they are not the same measurement. A `GRID_COMPACT`
 * cell holds a whole CONTROL — a picker with a chevron and room to read a master
 * name. A cell here holds a checkbox and a two-to-five character label. At 9rem a
 * popup needs ~46rem to fit five columns and most of every cell is empty; at
 * 6.5rem five columns fit in 34rem with the labels still comfortable.
 *
 * So it is a sibling constant, stated beside its neighbour rather than derived
 * from it, and this comment is the link between them. A literal for the same
 * reason `GRID_COMPACT` and `FIELD_TRACK` are: Tailwind v4 scans source text, so
 * `grid-cols-[repeat(auto-fill,${n})]` compiles to no CSS at all.
 */
const OPTION_GRID = "grid gap-x-1 gap-y-0.5";

/**
 * HOW WIDE A CELL HAS TO BE, IN CHARACTERS — clamped at both ends.
 *
 * The track used to be a fixed 6.5rem, which fitted four per row at 34rem and
 * spent room for nine characters on rendering "XL" (client 2026-08-20: "we are
 * listing 4 value per row, think compacted, maximum per what can we do").
 *
 * So the track is measured from the DATA instead. The label is `font-mono` in
 * this layout precisely so `ch` is an exact unit rather than an estimate —
 * that is the whole reason the two go together, and changing the label to a
 * proportional face silently makes this arithmetic a guess.
 *
 * BOTH CLAMPS EARN THEIR PLACE:
 *
 *   - the FLOOR stops a vocabulary of "S M L" drawing cells too small to aim a
 *     mouse at;
 *   - the CEILING is the one that matters. Track width is set by the LONGEST
 *     label, so a single "FREE SIZE" among 58 sizes would drag every cell out to
 *     fit it and halve the density for everything else. Past six characters the
 *     outlier truncates instead — which is safe here and nowhere else, because
 *     `Truncated` already gives it a hover/press reveal and the full value is
 *     also in the chip line below.
 */
const CELL_CH_MIN = 3;
const CELL_CH_MAX = 6;
/** Checkbox-free chip chrome: `px-2` either side plus the 1px borders. */
const CELL_CHROME = "1.15rem";

export type MultiSelectOption = {
  id: string;
  label: string;
  /** Read through `isInactive()` at the call site; a disabled master row. */
  inactive?: boolean;
};

export function MultiSelect({
  id: idProp,
  label,
  options,
  values,
  onChange,
  /* BLANK BY DEFAULT. An unfilled field shows NOTHING (the de-clutter rule) —
     a "Choose…" here would restate the label above it on every call site at
     once, which is how 352 placeholders survived the sweep that was supposed to
     remove them. A caller may still pass one, but only for a STATE of the
     record ("Pick a Style first"), never a description of the box. */
  placeholder = "",
  emptyLabel = "Nothing to choose from",
  required,
  disabled,
  compact,
  className,
  triggerClassName,
  panelClassName,
  groupBy,
  gridded,
  framed,
  onCreate,
}: {
  id?: string;
  label: string;
  options: MultiSelectOption[];
  /** Selected ids, in the order the caller wants them shown. */
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  /** Trigger-only, for a dense row: drops the label above the control. */
  compact?: boolean;
  className?: string;
  /**
   * Caps the TRIGGER and its popup, leaving the chip line free to use the whole
   * cell.
   *
   * A field's width normally comes from its `<Field size>` span and nothing
   * else — that is the one-width rule, and this does not weaken it. It exists
   * for the case where the CELL is deliberately wider than the control: a
   * dropdown holding "S" / "XL" stretched across half a section reads as broken,
   * while the chips beneath it genuinely want that width to wrap into. Two
   * different measurements in one cell, which a span alone cannot express.
   */
  triggerClassName?: string;
  /**
   * WIDTH FOR THE POPUP, SEPARATELY FROM THE TRIGGER.
   *
   * The panel is `w-full` of the trigger's wrapper, which welds the two together
   * — so capping the trigger at the client's 280px (2026-08-18, "that size
   * dropdown field size needs an update, it's too length") also capped the LIST
   * at 280px, and a 280px list can only ever be one column. One measurement was
   * doing two jobs, and the job it was chosen for was the trigger's.
   *
   * They are genuinely different questions: the trigger shows a summary ("8
   * selected") and wants to be small; the list shows the whole vocabulary and
   * wants to be wide. Omit and nothing changes — the panel keeps tracking the
   * trigger, so the existing behaviour is the default rather than a thing every
   * call site now has to restate.
   */
  panelClassName?: string;
  /**
   * BAND THE LIST BY A FAMILY THE CALLER DERIVES.
   *
   * Returns a stable `key` and a readable `label` per option; options sharing a
   * key are drawn under one heading, with an all/none control on it. Omit and
   * the list is flat, exactly as before.
   *
   * THE PRIMITIVE KNOWS NOTHING ABOUT SIZES. It is handed a function, because
   * "which family" is domain knowledge — `sizeFamily` in `lib/masters/
   * size-order.ts` for this screen, something else for the next one. Putting the
   * derivation behind this prop is what keeps a general control from growing a
   * garment vocabulary.
   *
   * BAND ORDER IS THE OPTION ORDER, not a sort of its own: the first option of a
   * family fixes where that family sits. So a caller that has already sorted its
   * options — which is the only way the bands can be internally ordered anyway —
   * gets headings in the same order for free, and there is no second rule to
   * drift from the first.
   */
  groupBy?: (option: MultiSelectOption) => { key: string; label: string };
  /**
   * LAY THE OPTIONS OUT AS A WRAPPING GRID instead of one per line.
   *
   * For a vocabulary of SHORT values — sizes, counts, gauges — where a column per
   * option spends a quarter of a metre of dropdown rendering "XL" and shows eight
   * rows at a time. Off by default: a list of master NAMES needs the full line,
   * and wrapping those into 6.5rem cells would truncate every one of them.
   *
   * The arrows change with the layout, which is the part that has to be right:
   * ←/→ move one cell and ↑/↓ move one ROW. That is the axis `ChildGrid` already
   * declares for a wrapping grid, not a new rule — see `onTriggerKeyDown`.
   */
  gridded?: boolean;
  /**
   * Draw the SAME frame a `ChildGrid` draws, for the case where this control
   * stands beside one.
   *
   * Off by default: a field in a row of fields must not grow a box of its own —
   * that is the over-framing the client cut back on 2026-08-18 ("too much
   * frames"). It is for the opposite fault, one row over: a bare control sharing
   * a row with a framed grid reads as floating, because the asymmetry looks like
   * something failed to render rather than like a deliberate difference.
   *
   * `GRID_FRAME` is imported rather than restated, so the two halves cannot
   * drift a pixel apart.
   */
  framed?: boolean;
  /**
   * TYPE A VALUE THAT DOES NOT EXIST YET AND STORE IT IN THE MASTER.
   *
   * Omit and the control is select-only. Supplied, a typed name that matches
   * nothing offers a "+ Add" row at the foot of the list — the same inline-CRUD
   * affordance every other dropdown in this app carries (the standing icon-field
   * rule: a field over stored data is a searchable dropdown WITH create, never a
   * plain text box that invents an unstored value).
   *
   * The call site owns the write, because only it knows which master this is.
   * It must return the stored label, not the typed one: the master's schema
   * applies `capsName()`, so what lands in the table is not always what was
   * typed.
   */
  onCreate?: (name: string) => Promise<{ id: string; label: string } | { error: string }>;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  /**
   * Values created in THIS session, merged over the server's list. The options
   * arrive as a prop from a server component, so without this a size the
   * operator just added is invisible until the next `router.refresh()` lands —
   * and it is already selected, which would read as the pick doing nothing.
   * Same device `LookupDialogPicker` uses, for the same reason.
   */
  const [extra, setExtra] = useState<MultiSelectOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const chosen = useMemo(() => new Set(values), [values]);

  const all = useMemo(() => {
    const byId = new Map(options.map((o) => [o.id, o]));
    for (const o of extra) byId.set(o.id, o); // a session create wins
    return [...byId.values()];
  }, [options, extra]);

  /**
   * An inactive row is dropped from the list — but never one the record already
   * holds. Dropping that would show a filled field as empty and blank the value
   * on the next save, which is the "Disabled rows" rule's whole point.
   */
  const selectable = useMemo(
    () => all.filter((o) => !o.inactive || chosen.has(o.id)),
    [all, chosen],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? selectable.filter((o) => o.label.toLowerCase().includes(q)) : selectable;
  }, [selectable, query]);

  /** The chips, in the caller's stored order, resolved to their labels. */
  const picked = useMemo(() => {
    const byId = new Map(all.map((o) => [o.id, o]));
    return values.map((v) => byId.get(v)).filter(Boolean) as MultiSelectOption[];
  }, [all, values]);

  /**
   * THE STAR HAS TO HAVE SOMETHING BEHIND IT.
   *
   * This control draws its own label, so it owns a `required` prop the way
   * `DataPicker` and `LookupDialogPicker` do — and a `required` that only drew a
   * red `*` would be decoration, letting Tab, Enter and ↓ walk straight out of a
   * field the record cannot be saved without. That exact bug shipped on every
   * picker in the app until 2026-08-10.
   *
   * ORed with the surrounding `<Field required>` inside the hook, so wrapping
   * this in one cannot silently un-require it. Empty means NOTHING CHOSEN — a
   * search query half-typed into the trigger is not a value.
   */
  const hold = useRequiredHold(!disabled && picked.length === 0, { required, label });

  // Close on a click outside. Pointerdown, not click, so a pick inside the panel
  // is never raced by the close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  /**
   * CLOSE WHEN THE CURSOR LEAVES — the keyboard's half of the rule above
   * (client 2026-08-19: "after choosing size, if I move to the next field the
   * size dropdown should close automatically").
   *
   * Closing on pointerdown-outside covers the MOUSE and nothing else, so an
   * operator who picked their sizes and pressed Tab left a full-height panel
   * hanging over the form while the caret blinked in Description behind it.
   * That is also what the contract already asks of any list: "Tab / Shift+Tab —
   * in an open list: close without choosing, then move."
   *
   * `focusout` ON THE ROOT, not a Tab handler on the trigger, because leaving is
   * leaving however it happens: Tab and Shift+Tab, an arrow off the edge of the
   * section, the blocked-Save reveal jumping to another field, the duplicate
   * catch-up pulling the cursor back. One listener answers all of them; a Tab
   * handler would answer one and leave the rest.
   *
   * `relatedTarget` inside the root means focus moved WITHIN the control — the
   * trigger to a checkbox row, a row to the "+ Add" — which must not close it.
   * A null `relatedTarget` (focus going nowhere) does close, which is right: a
   * panel with no cursor anywhere near it is exactly the one in the screenshot.
   *
   * Deliberately NOT preventing Tab. The skill is explicit that a list must
   * close without committing and let the key travel; claiming it here would trap
   * the operator in the field they just finished with.
   */
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Node && root.contains(to)) return;
      setOpen(false);
      setQuery("");
    };
    root.addEventListener("focusout", onFocusOut);
    return () => root.removeEventListener("focusout", onFocusOut);
  }, [open]);

  /**
   * OFFER "+ Add" ONLY FOR A NAME THAT IS NOT ALREADY A ROW.
   *
   * A candidate that already exists is one the master's unique constraint is
   * about to reject, so offering it is offering a click that lands on "already
   * exists" — the same rule the near-miss chips follow. The comparison is
   * trimmed and case-insensitive because the master stores CAPS: typing "xl"
   * beside a stored "XL" is the duplicate, not a new size.
   */
  const typed = query.trim();
  const offerCreate =
    !!onCreate &&
    typed !== "" &&
    !all.some((o) => o.label.trim().toLowerCase() === typed.toLowerCase());

  /**
   * The bands, in the order the options arrive — see the `groupBy` note. One
   * band with a null heading when the caller supplies no `groupBy`, so the
   * render path below has no second shape to maintain.
   */
  const bands = useMemo(() => {
    if (!groupBy) return [{ key: "", label: null as string | null, rows: filtered }];
    const out: { key: string; label: string | null; rows: MultiSelectOption[] }[] = [];
    const byKey = new Map<string, (typeof out)[number]>();
    for (const o of filtered) {
      const g = groupBy(o);
      let band = byKey.get(g.key);
      if (!band) {
        band = { key: g.key, label: g.label, rows: [] };
        byKey.set(g.key, band);
        out.push(band);
      }
      band.rows.push(o);
    }
    return out;
  }, [filtered, groupBy]);

  /**
   * What ↑/↓ walk and Enter picks — the options IN BAND ORDER, then the create
   * row if shown.
   *
   * Derived from `bands` rather than from `filtered`, and that is load-bearing
   * once banding is on: the cursor walks what the eye sees. Reading `filtered`
   * here would make ↓ jump between bands in a different order than the headings
   * are drawn, which is the same class of bug as the arrows and Tab disagreeing
   * inside a grid row.
   */
  const navIds = useMemo(
    () => [
      ...bands.flatMap((b) => b.rows.map((o) => o.id)),
      ...(offerCreate ? [CREATE_ID] : []),
    ],
    [bands, offerCreate],
  );

  /**
   * The track, sized to the widest label actually on screen.
   *
   * `minmax(…, 1fr)` rather than a fixed width: `auto-fill` decides HOW MANY
   * cells fit at the minimum, then `1fr` shares the slack between them, so the
   * grid is both as dense as the data allows and flush on the right instead of
   * ragged. A fixed track leaves the remainder as a gap at the end of every row.
   *
   * Measured over `filtered`, so narrowing the search tightens the grid with it.
   */
  const cellTrack = useMemo(() => {
    const widest = filtered.reduce((n, o) => Math.max(n, o.label.trim().length), 0);
    const ch = Math.min(CELL_CH_MAX, Math.max(CELL_CH_MIN, widest));
    return `repeat(auto-fill, minmax(calc(${ch}ch + ${CELL_CHROME}), 1fr))`;
  }, [filtered]);

  /**
   * WHERE A RANGE STARTS — the last option the operator deliberately ticked.
   *
   * A style runs "2Y through 14Y", and saying that by ticking thirteen boxes is
   * the work this removes (client 2026-08-19, "minimum 50 size"). Shift+click or
   * Shift+arrow fills everything between the anchor and the target.
   *
   * It only ever ADDS. A range that toggled would turn a second shift-click into
   * a partial erase of what the first one just selected, which is unpredictable
   * in a wrapping grid where "between" is not visually obvious. Adding is
   * always undoable one tick at a time; the ✕ on each chip and Clear are both
   * still there.
   */
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setHighlight((h) => h ?? navIds[0] ?? null);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const toggle = (optId: string) => {
    onChange(chosen.has(optId) ? values.filter((v) => v !== optId) : [...values, optId]);
  };

  /** Everything between the anchor and `id`, in the list's own order, ticked on. */
  const selectRangeTo = (id: string) => {
    const a = navIds.indexOf(anchorId ?? "");
    const b = navIds.indexOf(id);
    if (a === -1 || b === -1) {
      toggle(id);
      setAnchorId(id);
      return;
    }
    const span = navIds.slice(Math.min(a, b), Math.max(a, b) + 1);
    const add = span.filter((x) => x !== CREATE_ID && !chosen.has(x));
    if (add.length) onChange([...values, ...add]);
  };

  const create = async () => {
    if (!onCreate || creating || !typed) return;
    setCreating(true);
    setCreateError(null);
    const res = await onCreate(typed);
    setCreating(false);
    if ("error" in res) {
      // Said in place rather than thrown away: the unique constraint is the real
      // guard, so this is where "already exists" arrives if two operators race.
      setCreateError(res.error);
      return;
    }
    setExtra((xs) => [...xs, { id: res.id, label: res.label }]);
    onChange([...values, res.id]);
    setQuery(""); // the list reopens whole, with the new value ticked
    setHighlight(res.id);
  };

  /**
   * HOW MANY CELLS THE TRACK ACTUALLY DREW.
   *
   * Read off the RENDERED grid rather than computed from the panel's width: the
   * track is `auto-fill`, so the browser has already solved for the column count
   * against the real box, including the scrollbar and whatever the panel's own
   * padding turned out to be. `gridTemplateColumns` resolves to a list of pixel
   * tracks ("104px 104px 104px"), so counting them is exact.
   *
   * Recomputing it per keystroke rather than caching it in state is deliberate —
   * the count changes with the viewport, and a stale one sends ↓ to the wrong
   * row, which is the kind of bug that only shows up on somebody else's screen.
   */
  const columnCount = () => {
    const grid = listRef.current;
    if (!grid) return 1;
    const tracks = getComputedStyle(grid).gridTemplateColumns.trim();
    // "none" is what a non-grid <ul> reports, so the one-per-line layout falls
    // out of this as a 1-column grid without a branch of its own.
    if (!tracks || tracks === "none") return 1;
    return Math.max(1, tracks.split(/\s+/).length);
  };

  /**
   * Move the highlight by `delta` positions through `navIds`.
   *
   * A single linear walk serves both layouts because a wrapping grid IS a linear
   * list read in rows: ±1 is one cell, ±`columnCount()` is one row. Clamping
   * rather than wrapping means ↓ on the last row stays put instead of jumping to
   * the top — the same thing a child grid does, and the reason is the same, that
   * a silent wrap reads as the key having done nothing.
   */
  const step = (delta: number, extend = false) => {
    if (!navIds.length) return;
    const i = navIds.indexOf(highlight ?? "");
    const next = i === -1 ? (delta > 0 ? 0 : navIds.length - 1) : i + delta;
    const landed = navIds[Math.max(0, Math.min(navIds.length - 1, next))];
    setHighlight(landed);
    // Shift+arrow SELECTS as it moves. Done here rather than in each arrow
    // branch so ←/→ and ↑/↓ cannot end up with different range behaviour — the
    // same reason the four keys share one `step` at all.
    if (extend && anchorId && landed && landed !== CREATE_ID) selectRangeTo(landed);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      // A CLOSED LIST OPENS ON ↓ — the only keyboard route to a value, and the
      // reason a hold on this field is still satisfiable (`keyFills`).
      e.preventDefault();
      if (!open) openList();
      else step(gridded ? columnCount() : 1, e.shiftKey);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(gridded ? -columnCount() : -1, e.shiftKey);
      return;
    }
    /**
     * ←/→ WALK THE ROW, AND ONLY IN A GRID.
     *
     * Claimed here rather than left to bubble because in a wrapping layout the
     * cell to the right is a different option, not a different field — the same
     * exception `child-grid.tsx` takes for a grid row. In the one-per-line
     * layout there is nothing to the side, so the keys are deliberately NOT
     * claimed and the app's spatial arrow nav keeps them.
     */
    if (gridded && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1, e.shiftKey);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      // An OPEN list owns Enter: toggling IS filling, so this must never fall
      // through to Enter-advance or the save ladder. The list deliberately
      // stays open — picking several is the whole job.
      if (!highlight) return;
      e.preventDefault();
      e.stopPropagation();
      if (highlight === CREATE_ID) void create();
      else if (e.shiftKey && anchorId) selectRangeTo(highlight);
      else {
        toggle(highlight);
        // A plain tick MOVES the anchor; a range extension does not. That is
        // what lets Shift+↓ keep growing one selection instead of restarting it
        // from wherever the highlight last stopped.
        setAnchorId(highlight);
      }
      return;
    }
    if (e.key === "Escape") {
      // MUST preventDefault: the page-level Escape handler sits on `window` and
      // fires after `document`, so an unclaimed Escape navigates back.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const summary = picked.length
    ? `${picked.length} selected`
    : options.length
      ? placeholder
      : emptyLabel;

  return (
    <div
      ref={rootRef}
      /* A styling hook, same family as `data-field-affordance` below — no
         behaviour, nothing reads it but a stylesheet. `framed` draws the very
         same `GRID_FRAME` a `ChildGrid` draws, so a skin that stands those frames
         down has to be able to reach this one too; without a marker it is the one
         frame left standing and the control looks doubled. */
      data-framed={framed ? "" : undefined}
      className={cn("relative", framed && GRID_FRAME, className)}
    >
      {/* `compact` DROPS THE LABEL — AND THE STAR WITH IT, which is a trap worth
          naming because `required` keeps working in every other respect.
          `useRequiredHold` above is unconditional, so a compact + required
          MultiSelect still holds the cursor and still blocks Save; only the `*`
          disappears, leaving a field that refuses to be left and says nowhere
          why. Order Entry ▸ Styles ▸ Sizes shipped in exactly that state
          (client 2026-08-31: "there is no star").
          IT CANNOT BE FIXED HERE. `compact` MEANS "the caller draws the label",
          so there is no label of this control's to hang a star on — the same
          shape as `ChildGrid`'s stacked-cards rule in AGENTS.md, where a
          per-column `required` cannot reach a row the screen renders itself.
          SO A COMPACT CALL SITE THAT PASSES `required` MUST ALSO DECLARE IT ON
          THE `<Field>` DRAWING ITS LABEL. Doubling is safe: the hook ORs the two
          and the hold does not fire twice. */}
      {!compact && (
        <Label htmlFor={id}>
          {/* required-star: exempt -- this control renders its OWN label, so it
              owns `required` the way DataPicker does, and the star is BACKED:
              `useRequiredHold` above spreads `data-required-empty` onto the
              trigger from the same prop. Wrapping it in a <Field required>
              instead would draw a second label above this one. */}
          {label} {required && <span className="text-danger">*</span>}
        </Label>
      )}
      <div className={cn("relative", triggerClassName)}>
        <input
          id={id}
          ref={triggerRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={compact ? label : undefined}
          {...hold}
          data-field-trigger
          data-field-empty={picked.length ? "false" : "true"}
          disabled={disabled}
          // caps-input: exempt -- this box holds a SEARCH QUERY while the list
          // is open and a read-back summary while it is closed; neither is a
          // stored value, and the sizes themselves are never typed here. Same
          // carve-out data-picker.tsx's search field carries.
          // Chrome's remembered-values popup would sit on top of the list and
          // eat the ↓ that opens it; the managers read only their own markers.
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={open ? query : summary}
          placeholder={placeholder}
          onClick={() => (open ? close() : openList())}
          onChange={(e) => {
            setQuery(e.target.value);
            setCreateError(null);
            if (!open) setOpen(true);
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            // Same metrics as Input / DataPicker — these share rows with both.
            "h-9 @2xl/editor:h-8 w-full rounded-md border bg-surface pl-3 pr-9 text-base md:text-sm",
            // truncate-reveal: exempt -- the full selection is rendered in the
            // chip line below, so nothing here is the only copy of a value.
            "text-ellipsis placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "border-border hover:border-primary",
          )}
        />
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        {open && (
          /* THE PANEL IS A BOX AROUND THE LIST, not the list itself.
             The footer has to sit OUTSIDE the scroll region — a bulk action that
             scrolls away with the options is one the operator has to hunt for at
             exactly the moment they have stopped looking at the list. */
          <div
            className={cn(
              "absolute z-50 mt-1 w-full max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface shadow-lg",
              panelClassName,
            )}
          >
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-multiselectable
              // Inline, not a class: the track is computed from the data, and a
              // Tailwind arbitrary value cannot be — v4 scans source text, so
              // `grid-cols-[repeat(auto-fill,${n})]` compiles to no CSS at all.
              // That constraint is what made the old track a fixed literal in
              // the first place; the style attribute simply sidesteps it.
              style={gridded ? { gridTemplateColumns: cellTrack } : undefined}
              className={cn(
                "overflow-auto py-1",
                gridded
                  ? // The `<ul>` IS the grid — a <div> between <ul> and <li> is
                    // invalid, and `columnCount()` reads the resolved track off
                    // this element directly.
                    //
                    // `font-mono` HAS TO BE HERE, not only on the label. The `ch`
                    // in `cellTrack` resolves against the font of the element the
                    // style sits on — this <ul> — so with a proportional font
                    // here the track would be computed in one font's characters
                    // and filled with another's. The cells inherit it, which is
                    // also what makes every label line up.
                    // `text-[13px]` for the same reason as `font-mono`: `ch` is
                    // relative to the font SIZE as well as the family, so the
                    // track and the labels have to be computed at one size. The
                    // cells restate it rather than relying on inheritance, but
                    // it is this declaration the arithmetic reads.
                    cn(OPTION_GRID, "max-h-[min(60vh,19rem)] px-2 font-mono text-[13px]")
                  : "max-h-64",
              )}
            >
              {filtered.length === 0 && !offerCreate && (
                <li className="col-span-full px-3 py-2 font-sans text-sm text-muted-foreground">
                  {/* `font-sans`: a sentence, not a token — the grid sets
                      `font-mono` on the <ul> for the `ch` arithmetic. */}
                  {options.length ? "No match" : emptyLabel}
                </li>
              )}
              {bands.flatMap((band) => [
                /* THE HEADING. `role="presentation"` because it is not an option
                   — a listbox whose children are all options is what a screen
                   reader expects, and a heading announced as a choice would be a
                   choice that cannot be made.

                   `col-span-full` is what makes a band start a new grid row; the
                   partial row it leaves behind is correct, not a gap to close.

                   The all/none button is `tabIndex={-1}`, like every other
                   control inside this panel: Tab lands on FIELDS, and the panel
                   is reached through its trigger. */
                band.label !== null ? (
                  <li
                    key={`band:${band.key}`}
                    role="presentation"
                    className="col-span-full flex items-center gap-2 px-1.5 pb-1 pt-2.5 first:pt-1"
                  >
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {band.label}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-border" />
                    {(() => {
                      const ids = band.rows.map((o) => o.id);
                      const allOn = ids.every((x) => chosen.has(x));
                      return (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`${allOn ? "Clear" : "Select"} all ${band.label}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onChange(
                              allOn
                                ? values.filter((v) => !ids.includes(v))
                                : [...values, ...ids.filter((x) => !chosen.has(x))],
                            );
                          }}
                          className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary underline underline-offset-2"
                        >
                          {allOn ? "none" : "all"}
                        </button>
                      );
                    })()}
                  </li>
                ) : null,
                ...band.rows.map((o) => {
                const on = chosen.has(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      tabIndex={-1}
                      // A cell has no room for the "(inactive)" tag the full-width
                      // row carries, so in a grid the fact moves to the accessible
                      // name and to the dimming below. It is never DROPPED: an
                      // inactive option only ever appears here because the record
                      // already holds it, and saying so is the point.
                      aria-label={gridded && o.inactive ? `${o.label} (inactive)` : undefined}
                      // mousedown, not click: the trigger keeps focus, so the
                      // operator can carry straight on with the keyboard.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        // Shift+click takes everything between the last tick and
                        // this one — the mouse half of Shift+arrow.
                        if (e.shiftKey && anchorId) {
                          selectRangeTo(o.id);
                        } else {
                          toggle(o.id);
                          setAnchorId(o.id);
                        }
                        setHighlight(o.id);
                      }}
                      onMouseEnter={() => setHighlight(o.id)}
                      className={cn(
                        "flex w-full items-center text-left",
                        gridded
                          ? /* A CHIP, NOT A CHECKBOX AND A LABEL.
                               The square cost 22px — 16px box plus its gap — in a
                               cell that only ever holds two to six characters,
                               which is over a fifth of the cell spent restating
                               what the fill colour already says. Dropping it is
                               the single biggest density win available, and the
                               affordance survives three ways: the fill, the
                               `aria-selected` this button already carries, and
                               the chip line under the field.

                               `justify-center` because a chip reads as a token,
                               not as a row; ragged left edges across a wrapping
                               grid of 2-6 character labels look like a fault. */
                            cn(
                              "justify-center rounded border px-2 py-1 text-[13px] font-mono tabular-nums",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-surface",
                            )
                          : "gap-2 px-3 py-1.5 text-sm",
                        // The highlight must still read ON a filled chip, so it
                        // is a ring rather than a background swap.
                        highlight === o.id
                          ? gridded
                            ? "ring-2 ring-ring"
                            : "bg-surface-muted"
                          : "",
                        gridded && o.inactive ? "opacity-60" : "",
                      )}
                    >
                      {!gridded && (
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                      )}
                      {/* `touch={false}`: this row commits on mousedown, so a
                          press-and-hold would reveal the value AND pick it. */}
                      <Truncated touch={false}>{o.label}</Truncated>
                      {o.inactive && !gridded && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          (inactive)
                        </span>
                      )}
                    </button>
                  </li>
                );
                }),
              ])}
              {offerCreate && (
                <li className="col-span-full">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    tabIndex={-1}
                    disabled={creating}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void create();
                    }}
                    onMouseEnter={() => setHighlight(CREATE_ID)}
                    className={cn(
                      // `font-sans` because the grid above sets `font-mono` on
                      // the <ul> for the `ch` arithmetic, and this row is a
                      // sentence ("Add “XXXL”"), not a token.
                      "flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left font-sans text-sm font-medium text-primary",
                      highlight === CREATE_ID ? "bg-surface-muted" : "",
                      creating ? "opacity-60" : "",
                    )}
                  >
                    <Plus aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    {/* truncate-reveal: exempt -- this echoes what the operator
                        is typing THIS MOMENT, and the full text is in the box
                        directly above it. A press-and-hold bubble would also
                        reveal and CREATE in one gesture, since this row commits
                        on mousedown. */}
                    <span className="truncate">
                      {creating ? "Adding…" : `Add “${typed}”`}
                    </span>
                  </button>
                </li>
              )}
            </ul>

            {/* BULK ACTIONS, ONLY WHERE THE LIST IS LONG ENOUGH TO NEED THEM.
                Gated on `gridded` because that prop already means "a big
                vocabulary of short values" — which is exactly and only the case
                where ticking one at a time is the wrong shape of work.

                "Tick all SHOWN" respects the search, deliberately: an operator who
                has narrowed to what they want and then asks for all of it means
                all of THAT. A button that ignored the filter would be a different,
                much more destructive button wearing the same label. */}
            {gridded && (
              <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {picked.length} selected
                </span>
                <div className="flex gap-3">
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={filtered.length === 0}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const add = filtered.map((o) => o.id).filter((id) => !chosen.has(id));
                      if (add.length) onChange([...values, ...add]);
                    }}
                    className="text-xs font-medium text-primary disabled:text-muted-foreground"
                  >
                    Tick all shown
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={picked.length === 0}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange([]);
                    }}
                    className="text-xs font-medium text-primary disabled:text-muted-foreground"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {createError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {createError}
        </p>
      )}

      {/* THE CHOSEN VALUES, ON ONE LINE. This is the control's display half, not
          decoration: the trigger only ever says how many, so removing this would
          leave the selection unreadable without opening the list. The ✕ is the
          only way to drop one, and it is a real button so the mouse and a screen
          reader both reach it — but `tabIndex={-1}` keeps it off the typing path,
          the same treatment a ChildGrid row's Remove gets. */}
      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {picked.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted px-2 py-0.5 text-sm font-medium"
            >
              {o.label}
              {!disabled && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${o.label}`}
                  onClick={() => toggle(o.id)}
                  className="text-muted-foreground hover:text-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
