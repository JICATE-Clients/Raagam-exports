"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createMaterialAttribute,
  updateMaterialAttribute,
  deleteMaterialAttribute,
} from "@/lib/masters/material-attribute-actions";
import type { MaterialAttribute, MaterialAttributeInput } from "@/lib/masters/material-attribute-types";
import type { Attribute, ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import { CategoryPicker, AttributePicker } from "@/components/masters/lookup-picker";
import { ChildGrid, gridKeyNav } from "@/components/masters/child-grid";
import { IdentityRow } from "@/components/masters/section-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };

type OptionRow = { key: string; description: string; blocked: boolean };
type LineRow = {
  key: string;
  attribute_id: string;
  value_in_steps: boolean;
  start_value: string;
  end_value: string;
  /** Kept only so a line configured before 0350 saves back with its old UOM
   *  reference intact — nothing on this screen reads or sets it any more. */
  unit_id: string;
  unit_label: string;
  step_value: string;
  mandatory: boolean;
  inactive: boolean;
  options: OptionRow[];
  /**
   * The operator has hand-edited this stepped line's value list, so it is theirs
   * now and Start/End/Step/Unit stop rewriting it (client 2026-08-04).
   *
   * Needed because `genOptions` rebuilds the WHOLE list with fresh keys on every
   * range change. Without this, editing "3 MM" to "3 MM THICK" and then fixing a
   * typo in Step would silently discard the edit — which is the bug this file
   * already records once, when changing the Unit rewrote every description and
   * cleared every flag the user had set (client 2026-07-28).
   *
   * UI-only: never sent, never stored. A saved line comes back with its options
   * as plain rows, which is exactly what "the list is yours" means.
   */
  options_edited: boolean;
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Preview of the values a Value-In-Steps line will offer on the Material form
 *  (must mirror `stepValues` in material-master-screen.tsx): the start value,
 *  then step, 2×step, 3×step … above start and ≤ end. */
function previewSteps(start: number | null, end: number | null, step: number | null): number[] {
  if (start == null || end == null || !step || step <= 0 || end < start) return [];
  const out = [Number(start.toFixed(4))];
  for (let k = 1; k * step <= end + 1e-9 && out.length < 1000; k++) {
    const v = Number((k * step).toFixed(4));
    if (v > start) out.push(v);
  }
  return out;
}

/**
 * Master-detail CRUD for the legacy "Material attributes" master: a header
 * (Item Class scoped to Pack/Sew · Category) plus a per-attribute value-spec
 * grid (range/step/unit/mandatory/inactive), each line picking one of the
 * selected Item Class's Attribute Values (0293: Attribute was merged into
 * Item Class — the named-value child grid is what these lines pick from).
 *
 * dup-check: exempt -- the duplicate is prevented EARLIER and better here. The
 * identity is the (item_class_id, category_id) pair, and a category already
 * spoken for is removed from the Category picker, so the collision cannot be
 * typed in the first place. `uq_material_attributes_class_category` (0347) is
 * the backstop. A live check would also need `dup-guard`'s eq mode, since both
 * columns are uuids and `.ilike()` has no operator for them.
 */
export function MaterialAttributeMasterScreen({
  rows,
  attributes,
  categories,
  levies,
  fabricStructures,
  perms,
}: {
  rows: MaterialAttribute[];
  attributes: Attribute[];
  categories: Category[];
  levies: Levy[];
  fabricStructures: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [itemClassId, setItemClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Legacy screen has no separator field — the generated item name always joins
  // its parts with " / " (client 2026-07-25, matches legacy: "LABEL / MAIN / PRINTED / …").
  const NAME_SEPARATOR = " / ";
  const [lines, setLines] = useState<LineRow[]>([]);
  /**
   * The line and value keys that were ALREADY SAVED when this record opened.
   *
   * A stored row cannot be removed; one added since can (client 2026-08-10).
   * `ChildGrid.lockExisting` implements that for every other Master Data grid,
   * but this screen hand-rolls its own ✕ inside `renderMobileRow` — which those
   * columns never reach — so the same rule has to be stated here or this screen
   * alone would keep allowing what the other 26 now refuse. That remainder is
   * the "~22 screens hand-roll a grid row" lesson, one component along.
   *
   * Captured where the rows are BUILT from the stored record, so it is exact
   * rather than inferred: `openAdd` clears both, because a new record has
   * nothing saved yet.
   *
   * STATE, NOT A REF: these are written in an event handler and read while
   * rendering, which is what state is for. A ref read during render is the
   * `react-hooks/refs` shape and can tear across a concurrent render.
   */
  const [storedLineKeys, setStoredLineKeys] = useState<Set<string>>(new Set());
  const [storedOptionKeys, setStoredOptionKeys] = useState<Set<string>>(new Set());
  /**
   * Which attribute lines are showing their value list. A SET — any number at
   * once, like the legacy grid's ⊟/⊞ (screenshot 2026-07-27).
   *
   * It used to be one key, "at most one open", and the reason was purely
   * mechanical: a line's spec occupied several stacked rows, so a few open lines
   * pushed "+ Add attribute" below the fold (client 2026-07-27). Both halves of
   * that are gone — a line is one row now, and the trailing star row replaced the
   * button — so the restriction was buying nothing and cost the operator the
   * ability to compare two attributes side by side.
   */
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) =>
    setExpandedKeys((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;
  const optSeq = useRef(0);
  const newOptKey = () => `o${optSeq.current++}`;

  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes) m.set(a.id, a.name);
    return m;
  }, [attributes]);
  const categoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name || c.short_name || "—");
    return m;
  }, [categories]);
  const categoryShortName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.short_name || "—");
    return m;
  }, [categories]);
  const attrValueLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes) for (const v of a.values) m.set(v.id, v.value);
    return m;
  }, [attributes]);

  // Cascading options: Category and Attribute Value only ever show rows
  // scoped to the selected Item Class — never the full/global list.
  const scopedCategories = useMemo(
    () => categories.filter((c) => c.item_class_id === itemClassId),
    [categories, itemClassId],
  );
  // One config per (Item Class + Category): when adding, hide categories that
  // already have a config so a duplicate can't be created — the user edits the
  // existing one instead. When editing, the current category stays selectable.
  const configuredCategoryIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.item_class_id === itemClassId && r.category_id && r.id !== editId) s.add(r.category_id);
    }
    return s;
  }, [rows, itemClassId, editId]);
  const availableCategories = useMemo(
    () => scopedCategories.filter((c) => !configuredCategoryIds.has(c.id)),
    [scopedCategories, configuredCategoryIds],
  );
  const scopedAttributeValues = useMemo(
    () => attributes.find((a) => a.id === itemClassId)?.values ?? [],
    [attributes, itemClassId],
  );
  // Class CODE of the picked Item Class — drives which fields the Category
  // quick-create mini-child renders. Always PACK/SEW: the page filters
  // `attributes` through isAccessoryClass before this screen sees them.
  const selectedClassCode = useMemo(
    () => attributes.find((a) => a.id === itemClassId)?.code ?? null,
    [attributes, itemClassId],
  );

  function changeItemClass(v: string) {
    setItemClassId(v);
    setCategoryId("");
  }

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter<
    MaterialAttribute,
    { itemClass: string; category: string }
  >(rows, {
    search: (r, q) =>
      [
        classLabel.get(r.item_class_id ?? ""),
        categoryName.get(r.category_id ?? ""),
        categoryShortName.get(r.category_id ?? ""),
        ...r.lines.map((l) => attrValueLabel.get(l.attribute_id ?? "")),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      itemClass: (r, v) => r.item_class_id === v,
      category: (r, v) => r.category_id === v,
    },
    initialFilters: { itemClass: "", category: "" },
  });

  /*
   * THE CATEGORY FACET FOLLOWS THE ITEM CLASS FACET BESIDE IT — the same
   * cascading rule `scopedCategories` above already gives the EDITOR, which the
   * filter bar was quietly breaking: it mapped the FULL category list, so under
   * Item Class = PACKING ACCESSORIES the dropdown still offered CHAMBRAY and
   * COLLAR, and picking one emptied the table with nothing on screen to say why
   * (client 2026-08-11). Same bug, and same fix, as the Materials master's own
   * filter bar (`material-master-screen.tsx`).
   *
   * The unscoped list is narrowed too, and that part is particular to this
   * screen: `attributes` reaches it already filtered through `isAccessoryClass`
   * (see the page), so a Material Attribute can only ever be Pack or Sew. A
   * Fabric category in this dropdown is therefore not merely unhelpful — it is
   * an option that CANNOT match a row, whatever else is selected.
   *
   * With no class chosen the survivors are prefixed by their class: category
   * names repeat across classes (COTTON is a Yarn and a Fabric), and two
   * identical options the operator has to guess between is the other half of
   * the same bug.
   */
  const filterCategories = useMemo(() => {
    const cls = filterValues.itemClass;
    const inScope = (c: Category) =>
      cls ? c.item_class_id === cls : classLabel.has(c.item_class_id ?? "");
    return categories
      .filter(inScope)
      .map((c) => ({
        id: c.id,
        label: cls
          ? c.name || c.short_name || "—"
          : `${classLabel.get(c.item_class_id ?? "") ?? "—"} · ${c.name || c.short_name || "—"}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [categories, classLabel, filterValues.itemClass]);

  const pg = usePagination(filtered, 10);

  function blankLine(): LineRow {
    return {
      key: newKey(),
      attribute_id: "",
      value_in_steps: false,
      start_value: "",
      end_value: "",
      unit_id: "",
      unit_label: "",
      step_value: "",
      mandatory: false,
      inactive: false,
      // No values, and no blank one either. A value box appears when the operator
      // asks for one — "+ Add value", or Enter off the last value — never as a
      // permanently open empty field (client 2026-08-04).
      options: [],
      options_edited: false,
    };
  }

  /**
   * THE STAR ROW. Legacy's grid always ends in a blank `*` line: you type in it
   * and it becomes a row, and a fresh blank takes its place (screenshot
   * 2026-07-27). That is the whole add affordance — legacy has no "+ Add"
   * button anywhere on this screen, which is why asking where ours should sit
   * kept producing unsatisfying answers.
   *
   * Cheap to keep honest: `submit()` already drops lines with no attribute
   * picked, so the trailing blank never reaches the server.
   */
  const withStarRow = (ls: LineRow[]): LineRow[] =>
    ls.length && !ls[ls.length - 1].attribute_id ? ls : [...ls, blankLine()];

  /**
   * HAS THE OPERATOR STARTED THIS ROW? Everything on a line EXCEPT the attribute
   * itself — the star row is blank by definition, so asking "is the attribute
   * empty" cannot tell an untouched placeholder apart from a row someone has
   * begun filling in.
   *
   * That distinction is the whole of the hold below, and getting it wrong costs
   * data either way. Keyed on `attribute_id` alone (as it was until 2026-08-11),
   * a line carrying a Start Value, a Unit and a ticked Mandatory stayed "the
   * star row": un-required, un-held, and then **dropped by `submit()`**, which
   * dismisses any line with no attribute. The operator typed into a row, left
   * it, saved, and the work was gone with nothing said — precisely the loss the
   * comment on `attrCell` says the hold exists to stop, walking straight through
   * the exemption beside it.
   *
   * `unit_label` and `options_edited` are deliberately NOT here: the first is a
   * display echo of `unit_id`, the second a bookkeeping flag, and neither is
   * something the operator typed. `key` is identity. Counting either would make
   * a fresh blank row read as started and re-cage the grid on the row nobody
   * asked for.
   */
  const rowStarted = (l: LineRow): boolean =>
    !!l.start_value ||
    !!l.end_value ||
    !!l.unit_id ||
    !!l.step_value ||
    l.value_in_steps ||
    l.mandatory ||
    l.inactive ||
    l.options.length > 0;

  function openAdd() {
    setEditId(null);
    setItemClassId("");
    setCategoryId("");
    const first = blankLine();
    // Nothing is saved on a new record, so every row stays removable.
    setStoredLineKeys(new Set());
    setStoredOptionKeys(new Set());
    setLines([first]);
    setExpandedKeys(new Set([first.key]));
    setOpen(true);
  }
  function openEdit(r: MaterialAttribute) {
    setEditId(r.id);
    setItemClassId(r.item_class_id ?? "");
    setCategoryId(r.category_id ?? "");
    const built: LineRow[] =
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            attribute_id: l.attribute_id ?? "",
            value_in_steps: l.value_in_steps,
            start_value: l.start_value != null ? String(l.start_value) : "",
            end_value: l.end_value != null ? String(l.end_value) : "",
            unit_id: l.unit_id ?? "",
            unit_label: l.unit_label ?? "",
            step_value: l.step_value != null ? String(l.step_value) : "",
            mandatory: l.mandatory,
            inactive: l.inactive,
            options: (l.options ?? []).map((o) => ({
              key: newOptKey(),
              description: o.description,
              blocked: o.blocked,
            })),
            // A SAVED line's list is already the operator's — it is whatever they
            // last chose to store. Re-deriving it on open would silently discard
            // any edit made in an earlier session, so a stepped line only
            // regenerates when it has no stored values to lose.
            options_edited: (l.options ?? []).length > 0,
          }))
        : [];
    setStoredLineKeys(new Set(built.map((l) => l.key)));
    setStoredOptionKeys(new Set(built.flatMap((l) => l.options.map((op) => op.key))));
    setLines(withStarRow(built));
    // A stepped line with NO stored values re-derives them so the list shows
    // immediately. One that HAS them keeps them — see `options_edited`: those
    // rows are what the operator chose to save, and regenerating would discard
    // an edit made in an earlier session.
    setLines((ls) =>
      ls.map((l) => (l.value_in_steps && !l.options_edited ? { ...l, options: genOptions(l) } : l)),
    );
    // Open the first line: on an existing record the user is usually here to
    // change one attribute, and a fully collapsed list gives no clue that the
    // rows expand at all.
    setExpandedKeys(new Set(built[0] ? [built[0].key] : []));
    setOpen(true);
  }

  /**
   * Patch a line and re-assert the star row: the moment the trailing blank gains
   * an attribute it stops being the star row, so a fresh blank takes its place.
   * That single rule is the whole "add" mechanism on this screen.
   */
  const setLineAt = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) => withStarRow(ls.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  const removeLine = (key: string) => {
    setLines((ls) => withStarRow(ls.filter((l) => l.key !== key)));
    setExpandedKeys((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  };

  /**
   * Picking the attribute is what turns the star row into a real line, so it is
   * also the moment to OPEN it.
   *
   * Without this the new row arrived collapsed and the operator had to click its
   * chevron before they could type a single value — "if the user moves to the
   * next attribute it is automatically closed" (client 2026-08-04). Nothing was
   * closing it; it had simply never been opened, which looks identical from the
   * outside. Opening on the pick means the whole flow — pick, type values, move
   * on — never needs the mouse.
   *
   * Only ever ADDS a key. Whatever else the operator has open stays open; that
   * is the point of `expandedKeys` being a set.
   */
  const pickAttribute = (key: string, attributeId: string) => {
    setLineAt(key, { attribute_id: attributeId });
    if (attributeId) setExpandedKeys((s) => (s.has(key) ? s : new Set(s).add(key)));
  };

  /**
   * Per-line pre-defined value list (legacy nested grid). Enter on the last
   * value adds the next one, so a held Enter would otherwise stack blank rows —
   * there is nothing to add until the row already there has been typed into.
   *
   * THE REFUSAL IS THE ESCALATION. Returning `false` makes `gridKeyNav` decline
   * the key instead of swallowing it, so Enter carries up to the attribute grid
   * and starts the next ATTRIBUTE. That is the whole "Enter Enter" path: Enter
   * after the last value opens a blank box, Enter on the blank box means "no
   * more values here" and moves the operator on. Before this the refusal
   * happened inside the `setLines` updater, where the caller could not see it,
   * and Enter was simply dead in that box (client 2026-08-04).
   *
   * Decided against the current `lines`, not inside the updater, because the
   * answer has to be known SYNCHRONOUSLY — the keydown is already deciding
   * whether to preventDefault.
   */
  const addOption = (lineKey: string): boolean => {
    const line = lines.find((l) => l.key === lineKey);
    if (!line) return false;
    const last = line.options[line.options.length - 1];
    if (last && !last.description.trim()) return false;
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? { ...l, options: [...l.options, { key: newOptKey(), description: "", blocked: false }] }
          : l,
      ),
    );
    return true;
  };
  const setOptionAt = (lineKey: string, optKey: string, patch: Partial<OptionRow>) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? {
              ...l,
              // Editing a value is what makes the list the operator's — from
              // here the range fields stop regenerating it. See `options_edited`.
              options_edited: true,
              options: l.options.map((o) => (o.key === optKey ? { ...o, ...patch } : o)),
            }
          : l,
      ),
    );
  const removeOption = (lineKey: string, optKey: string) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? { ...l, options_edited: true, options: l.options.filter((o) => o.key !== optKey) }
          : l,
      ),
    );

  // Regenerate a Value-In-Steps line's value list from Start/End/Step/Unit.
  // This is what auto-fills "0 MM, 10 MM … 100 MM" (legacy 2100).
  //
  // Generated values are never individually blocked — narrow Start/End/Step
  // instead. This used to carry blocked flags across a regen by matching on the
  // description string, which meant changing the Unit rewrote every description
  // ("10" → "10 MM") and silently cleared every flag the user had set. With the
  // per-value box gone for stepped lines, that whole failure mode goes with it.
  const genOptions = (l: LineRow): OptionRow[] => {
    const vals = previewSteps(numOrNull(l.start_value), numOrNull(l.end_value), numOrNull(l.step_value));
    // Typed label, not a UOM lookup (client 2026-07-28) — see the Unit field.
    const uname = l.unit_label.trim();
    return vals.map((v) => ({
      key: newOptKey(),
      description: uname ? `${v} ${uname}` : String(v),
      blocked: false,
    }));
  };
  /**
   * Duplicates, caught as they are typed (client 2026-07-28).
   *
   * The screen used to accept the same attribute on two lines of one set, and
   * the same value twice inside one attribute's list — both save cleanly and
   * then show up twice in the Material form's dropdown, which is where the
   * client found them. 0350 forbids both in the database
   * (`uq_material_attribute_lines_attr`, `uq_mal_options_desc`) and the actions
   * reject a stale post; these two sets are what turns the row red and holds
   * Save while it is still fixable.
   *
   * Blanks never count: an unpicked line or an empty value box is unfinished,
   * not wrong.
   */
  const duplicateAttrIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const l of lines) {
      if (!l.attribute_id) continue;
      if (seen.has(l.attribute_id)) dup.add(l.attribute_id);
      else seen.add(l.attribute_id);
    }
    return dup;
  }, [lines]);
  /** line key → the normalised descriptions that appear more than once in it.
   *  Normalised the same way as the DB index: trimmed and upper-cased. */
  const duplicateOptions = useMemo(() => {
    const byLine = new Map<string, Set<string>>();
    for (const l of lines) {
      const seen = new Set<string>();
      const dup = new Set<string>();
      for (const o of l.options) {
        const norm = o.description.trim().toUpperCase();
        if (!norm) continue;
        if (seen.has(norm)) dup.add(norm);
        else seen.add(norm);
      }
      byLine.set(l.key, dup);
    }
    return byLine;
  }, [lines]);
  const hasDuplicateLine = duplicateAttrIds.size > 0;

  /**
   * A line the operator has BEGUN but given no attribute — the Save-button half
   * of the same `required` the Attribute cell holds the cursor on. `submit()`
   * drops any line with no `attribute_id`, so without this the mouse route
   * saved the record and binned the row without a word.
   *
   * Deliberately NOT `lines.some((l) => !l.attribute_id)`: the trailing star row
   * is blank on purpose and is the row that makes the grid usable. Only a row
   * with something ON it counts, which is exactly what `rowStarted` decides for
   * the hold — one predicate, so the button and the cursor can never disagree
   * about which rows are real.
   */
  const hasStartedBlankLine = useMemo(
    () => lines.some((l) => !l.attribute_id && rowStarted(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines],
  );
  // Stepped lines can't produce a duplicate (previewSteps is strictly
  // increasing), but they are counted anyway — the gate should follow the DB
  // constraint, not an argument about why it can't be hit.
  const hasDuplicateOption = useMemo(
    () => [...duplicateOptions.values()].some((s) => s.size > 0),
    [duplicateOptions],
  );

  // Update a line and, when it is Value-In-Steps, regenerate its value list so
  // the rows stay in sync with the Start/End/Step/Unit fields.
  const patchLine = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // A stepped line regenerates from Start/End/Step/Unit — UNTIL the
        // operator edits the list, after which it is theirs and the range fields
        // stop rewriting it. Ticking Value In Steps ON is the one thing that
        // always regenerates: that is the operator asking for a fresh list.
        const turningStepsOn = patch.value_in_steps === true && !l.value_in_steps;
        if (next.value_in_steps && (turningStepsOn || !next.options_edited)) {
          next.options = genOptions(next);
          if (turningStepsOn) next.options_edited = false;
        }
        return next;
      }),
    );

  function submit() {
    startTransition(async () => {
      const payload: MaterialAttributeInput = {
        // Both mandatory now — the pair is this record's unique key (0347). Save
        // is already disabled until each is picked, so the empty string can only
        // reach here if that gate is ever removed, and the schema will say so.
        item_class_id: itemClassId,
        category_id: categoryId,
        name_separator: NAME_SEPARATOR,
        lines: lines
          .filter((l) => l.attribute_id)
          .map((l, i) => ({
            sno: i + 1,
            attribute_id: l.attribute_id,
            value_in_steps: l.value_in_steps,
            start_value: numOrNull(l.start_value),
            end_value: numOrNull(l.end_value),
            // unit_id is never edited here any more, but keeps round-tripping
            // so a pre-0350 line is not stripped of it by an unrelated edit.
            unit_id: l.unit_id || null,
            unit_label: l.unit_label.trim() || null,
            step_value: numOrNull(l.step_value),
            mandatory: l.mandatory,
            inactive: l.inactive,
            // Persist the value list for BOTH stepped (auto-generated) and
            // manual lines — it's the single source of the Material dropdown.
            options: l.options
              .filter((o) => o.description.trim())
              .map((o, j) => ({ sno: j + 1, description: o.description.trim(), blocked: o.blocked })),
          })),
      };
      const res = editId
        ? await updateMaterialAttribute(editId, payload)
        : await createMaterialAttribute(payload);
      if (res.ok) {
        success(editId ? "Material attribute updated." : "Material attribute added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: MaterialAttribute) {
    startTransition(async () => {
      const res = await deleteMaterialAttribute(r.id);
      if (res.ok) {
        success("Material attribute deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<MaterialAttribute>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Category",
      cell: (r) => <span className="text-sm">{r.category_id ? categoryName.get(r.category_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Attributes",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.lines.length}</span>,
    },
    rowActionsColumn((r) => (
      <RowActions
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        // A set some Material already answers cannot be deleted, and the LIST
        // knows it (`in_use` / `used_by`), so say so on the bin rather than
        // walking the operator through Delete? → Confirm → an error toast.
        // Wording matches `deleteOrBlock`'s, which is what refuses the delete if
        // one is attempted anyway.
        deleteDisabledReason={
          r.in_use ? `In use by ${r.used_by ?? "Materials"} — cannot delete.` : null
        }
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search material attributes…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={reset}
        >
          <div>
            <Label htmlFor="ma-filter-class">Item Class</Label>
            <Select
              id="ma-filter-class"
              value={filterValues.itemClass}
              onChange={(e) => {
                const v = e.target.value;
                setFilter("itemClass", v);
                // A category belonging to the class just left matches no row —
                // drop it rather than leave an empty table and an invisible
                // reason. Cleared only when it really is out of scope, so
                // narrowing Item Class around the category you already picked
                // keeps it.
                const held = categories.find((c) => c.id === filterValues.category);
                if (v && held && held.item_class_id !== v) setFilter("category", "");
                pg.setPage(1);
              }}
            >
              <option value="">All</option>
              {attributes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ma-filter-cat">Category</Label>
            <Select
              id="ma-filter-cat"
              value={filterValues.category}
              onChange={(e) => {
                setFilter("category", e.target.value);
                pg.setPage(1);
              }}
            >
              <option value="">All</option>
              {filterCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="material-attributes" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Material Attribute
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged} getKey={(r) => r.id} empty="No material attributes yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No material attributes yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="text-[15px] font-semibold text-foreground">
                {r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.category_id ? categoryName.get(r.category_id) ?? "—" : "No category"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
              <div className="mt-2 text-[13px] text-muted-foreground">
                {r.lines.length} attribute{r.lines.length === 1 ? "" : "s"}
              </div>
            </button>
          ))
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Material Attribute" : "New Material Attribute"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              // Duplicates block the save rather than being silently dropped —
              // the offending row is already red, so the disabled button has an
              // explanation on screen.
              //
              // `hasStartedBlankLine` is the SAME declaration as the cursor hold
              // on the Attribute cell, reaching the Save button as AGENTS.md
              // requires ("one declaration, four enforcers"). The hold alone
              // only closes the keyboard route: it refuses forward movement, so
              // a keyboard operator cannot reach Save past a started row with no
              // attribute — but the mouse was never held, and `submit()` drops
              // any line with no attribute, so clicking Save still binned the
              // work in silence. The row also carries its own red message, so
              // the disabled button has its reason on screen.
              disabled={
                isPending ||
                !itemClassId ||
                !categoryId ||
                hasDuplicateLine ||
                hasDuplicateOption ||
                hasStartedBlankLine
              }
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Single column, header ABOVE the attributes (client 2026-07-27).
              This used to be `lg:grid-cols-2` with the header on the left and
              the attribute lines on the right — but the header holds exactly
              two fields, so the left half was empty for the entire height of
              the attributes panel while the panel itself was squeezed into
              ~570px and every line wrapped. Stacking gives the lines the full
              1180px, which is what lets the picker and the three flags share
              one row instead of three. */}
          {/* The record's IDENTITY, not a section: `(item_class_id,
              category_id)` is the unique key behind
              `uq_material_attributes_class_category`, which is exactly what
              `IdentityRow` is for — a full-width band with no border and no
              caption, because the thing that identifies a record needs none.
              (It replaced a `DetailSection label="Header"`, whose caption named
              nothing and whose chrome cost a row of vertical space.) Same
              treatment as the Material editor's own identity row.

              Category takes the wider track: it is free text and holds the
              longer value, while Item Class is a two-value enum that must not
              sprawl to match it.

              The children are `Field`s with NO `size`. Span classes only
              resolve inside `@container/section` and there is none here, so
              they fall through to the full width of their track — the
              documented fallback (field.tsx), and what lets the tracks below
              own the widths. */}
          <IdentityRow tracks="minmax(0,1fr) minmax(0,1.4fr)">
            <Field
              label="Item Class"
              required
              htmlFor="ma-item-class"
              hint="Sewing and Packing only"
            >
              {/* A plain <Select>, not a picker, and deliberately so: the rest
                  of this form is READ OFF the chosen class. Its attribute
                  values (`scopedAttributeValues`) and its code both come from the
                  selected row, and Category below is scoped to it — so a class
                  created inline would select itself and leave the panel with no
                  attributes to line up. The list is also pre-filtered to the
                  accessory classes this screen is for (see the note below),
                  which a picker's "+ Add" would quietly widen. Item Classes are
                  maintained on their own master. */}
              <Select
                id="ma-item-class"
                value={itemClassId}
                onChange={(e) => changeItemClass(e.target.value)}
              >
                <option value=""></option>
                {/* `attributes` arrives pre-filtered to accessory classes by the
                    page (see the isAccessoryClass filter there) — this only
                    drops inactive rows. */}
                {attributes
                  .filter((c) => c.is_active || c.id === itemClassId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {/* The label is `Field`'s, not the picker's. Passing `label` down
                made the picker render its OWN <Label> — no `htmlFor`, and a
                plain space before the required marker instead of `ml-0.5` — so
                the two asterisks on this row sat at different offsets and only
                Item Class was click-focusable.

                BUT NO VISIBLE LABEL IS NOT NO NAME, and conflating the two is
                what `title` exists for (see the prop on `CategoryPicker`). With
                `label=""` and nothing else, every string the picker builds from
                its noun came out blank — the panel read "Select ", the clear
                button announced "Clear ", the empty list said "No  found." —
                and the mandatory hold announced " is required." with no field
                name (2026-08-11). `title` names the field for all of them while
                the label above stays the only one DRAWN, and `htmlFor`/`id`
                give the input the accessible name and the click target that the
                note above says it lost. */}
            <Field
              label="Category"
              required
              htmlFor="ma-category"
              hint={
                !itemClassId
                  ? "Pick an Item Class first."
                  : !editId && availableCategories.length === 0
                    ? "Every category for this Item Class already has a Material Attribute set — edit the existing one from the list instead."
                    : undefined
              }
            >
              <CategoryPicker
                label=""
                title="Category"
                id="ma-category"
                // The noun now names the field, so the default empty state
                // would read "— Select Category —" where it has always read
                // "— Select —" (LAYOUT.md §5a, and the label above already says
                // which). Stated so `title` changes the NAMES and not the text.
                categories={availableCategories}
                value={categoryId}
                onChange={setCategoryId}
                itemClassId={itemClassId}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                fabricStructures={fabricStructures}
              />
            </Field>
          </IdentityRow>

          {/* Attribute lines — meaningless until an Item Class scopes the
              pickable values, so keep the placeholder gate here */}
          <div className="space-y-4">
          {!itemClassId ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-12 text-center text-sm text-muted-foreground">
              Select an Item Class above to add its attribute lines.
            </div>
          ) : (
          <div>
          {(() => {
            /**
             * THE LEGACY ROW, as columns.
             *
             * One attribute is one line and its flags are columns
             * (`doc/screen/87106156_HRSERVER2772026_111050.png`) — that is what
             * lets eight fields fit where the stacked card fitted three, because
             * the labels come off every row and are said once in the strip above.
             *
             * The track is an inline `gridTemplateColumns`, not a `grid-cols-*`
             * class: column widths are DATA, the same reasoning (and the same
             * technique) as `IdentityRow` in section-grid.tsx. It is declared
             * once and used by both the header strip and every row, so the two
             * cannot drift.
             */
            const ROW_TRACKS =
              "2rem 2.5rem minmax(9rem,1fr) 6.5rem 6rem 6rem 5rem 6rem 6rem 5.5rem 2rem";
            const HEADINGS = [
              "", "#", "Attribute", "Value In Steps",
              "Start Value", "End Value", "Unit", "Step Value",
              "Mandatory", "Blocked", "",
            ];
            const headerStrip = (
              <div
                className="grid items-end gap-x-2 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: ROW_TRACKS }}
              >
                {HEADINGS.map((h, i) => (
                  <div key={i} className={cn(i >= 3 && i <= 9 && "text-center")}>
                    {h}
                  </div>
                ))}
              </div>
            );

            // The picker ALONE — no wrapper, no message underneath. It is the
            // row's identity control and lives in the Attribute column, where a
            // second stacked element would push the line to two rows in the
            // duplicate state. The caller renders the warning under it.
            const attrCell = (l: LineRow) => (
              <AttributePicker
                label=""
                values={scopedAttributeValues}
                value={l.attribute_id}
                onChange={(v) => pickAttribute(l.key, v)}
                invalid={!!l.attribute_id && duplicateAttrIds.has(l.attribute_id)}
                // MANDATORY ON A ROW THE OPERATOR HAS STARTED, and on no other.
                // `submit()` drops a line with no attribute, so a STARTED row
                // that is blank has been CLEARED and silently loses whatever
                // else is on it — exactly what the hold exists to stop. A line
                // carrying nothing loses nothing and blocks no save, so it must
                // not hold: AGENTS.md's test is "must the record be unsaveable
                // without it?", and `hasStartedBlankLine` — the Save-button half
                // of this same declaration — does not count such a row either.
                //
                // Keyed on `rowStarted`, NOT on `isStar`. That one carries an
                // extra "and it is the LAST line" clause, which it needs for the
                // placeholder treatment (the "+", the missing ✕) and which has
                // no business in a `required`: reusing it made the cursor and
                // the Save button disagree about which rows are real, so
                // clearing an EMPTY middle row refused forward movement while
                // Save stayed enabled — and once that line was a stored one it
                // could not be removed either, leaving the operator holding a
                // row they could not fill, leave, or delete (2026-08-11).
                //
                // Declared here rather than through `ChildGridColumn.required`
                // because requiredness here is a property of the ROW, not of the
                // column — and because this screen renders `renderMobileRow`,
                // which those columns never reach (child-grid.tsx says so where
                // the prop is defined). The picker's own `required` is the
                // sanctioned second way in, and it is the same prop that draws
                // the `*`.
                required={rowStarted(l)}
              />
            );

            /**
             * Start / End / Unit / Step are ALWAYS PRESENT, and disabled unless
             * the line is Value In Steps.
             *
             * Legacy leaves them live and showing `0.00` on every row, stepped or
             * not, which invites an operator to type a range that nothing will
             * ever read. Keeping the columns preserves the rectangle — a grid
             * whose cells appear and disappear per row is not a grid — while
             * disabling them says which rows they belong to. `Input` sets
             * `tabIndex={-1}` on a disabled control itself, so the whole group
             * leaves the Tab order on a non-stepped row without this screen
             * saying anything.
             */
            const numCell = (
              l: LineRow,
              field: "start_value" | "end_value" | "step_value",
            ) => (
              <Input
                type="number"
                step="0.0001"
                className="text-right tabular-nums"
                disabled={!l.value_in_steps}
                value={l[field]}
                onChange={(e) => patchLine(l.key, { [field]: e.target.value })}
              />
            );
            // Typed, not picked from the UOM master (client 2026-07-28). It is
            // only ever printed onto the generated values ("10 MM") — nothing
            // converts by it — so the FK made the user maintain a UOM row for
            // every label they wanted to print.
            const unitCell = (l: LineRow) => (
              <Input
                uppercase
                disabled={!l.value_in_steps}
                value={l.unit_label}
                onChange={(e) => patchLine(l.key, { unit_label: e.target.value })}
                placeholder="MM"
              />
            );
            const flagCell = (l: LineRow, field: "value_in_steps" | "mandatory" | "inactive") => (
              // Centred in its column and `min-h-9` so the box sits on the same
              // 36px control line as the inputs either side of it.
              <div className="flex min-h-9 items-center justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  // BLOCKED IS OFF THE TYPING PATH. `inactive` is the column shown
                  // as **Blocked** (see `HEADINGS` and the `aria-label` below) —
                  // switching one attribute line off, an escape hatch the operator
                  // reaches for deliberately, not a value they enter on the way
                  // past. Tab stopped on it in every row (client 2026-08-11).
                  //
                  // `data-focus-optional` (lib/focus.ts) takes it off Tab and Enter
                  // and leaves it on ← → and the mouse, which is why it is the
                  // marker here and `tabIndex={-1}` is not: `ROW_FIELDS` counts a
                  // checkbox on purpose, and dropping one out of the arrow axis
                  // made a tick-box cell a dead end (client 2026-07-28).
                  //
                  // Marked only while UNTICKED, the same way Fabric's Direct
                  // Purchase is: once a line IS blocked, the box that unblocks it is
                  // back on the Tab path exactly when the operator wants it. Value
                  // In Steps and Mandatory are ordinary per-line values and stay.
                  data-focus-optional={field === "inactive" && !l[field] ? "" : undefined}
                  checked={l[field]}
                  // Toggling Value In Steps regenerates the value list; the other
                  // two flags don't touch it.
                  onChange={(e) =>
                    field === "value_in_steps"
                      ? patchLine(l.key, { value_in_steps: e.target.checked })
                      : setLineAt(l.key, { [field]: e.target.checked })
                  }
                  aria-label={
                    field === "value_in_steps"
                      ? "Value in steps"
                      : field === "mandatory"
                        ? "Mandatory"
                        : "Blocked"
                  }
                />
              </div>
            );

            /**
             * The line's value list — the single source of the Material form's
             * dropdown.
             *
             * A BORDERED SUB-PANEL WITH ITS OWN HEADER, indented under the
             * Attribute column, which is how legacy nests it. Without the box it
             * read as orphaned (client 2026-08-04): a lone input floating in the
             * band between one attribute row and the next, with nothing saying
             * which row it belonged to. Indentation is not containment — the
             * border is what makes it a child of the row above.
             *
             * `#` earns its column for the same reason legacy has one: it gives
             * the operator something to say ("value 3 is wrong") about a list of
             * otherwise interchangeable text boxes.
             *
             * ONE VALUE PER ROW. That is legacy's shape (its sub-grid lists
             * PLAIN / WITH CENTRE / WITH "O" RING as three rows) and the only one
             * the keyboard can serve: four-across needs the values chunked four
             * to a `data-grid-row` so the arrows stay spatial, and Enter then
             * means "next chunk", which leaves the star row unreachable by the
             * very key meant to reach it. The width the card layout wasted is
             * reclaimed by the columns on the attribute row instead.
             *
             * BOTH KINDS ARE EDITABLE. A Value-In-Steps line SEEDS its list from
             * Start/End/Step/Unit, and the rows were read-only chips until the
             * client asked to edit them (2026-08-04) — narrowing the range was
             * the only way to change a value, which cannot relabel one.
             *
             * The seed then has to stop overwriting them, or the first correction
             * to Step silently discards every edit. `options_edited` is that
             * latch: touching any value hands the list to the operator, the range
             * fields stop rewriting it, and the caption says so with a
             * "Regenerate" button as the way back. Re-ticking Value In Steps also
             * regenerates — that is the operator asking for a fresh list.
             */
            const VALUE_TRACKS = "2.5rem minmax(0,1fr) 2rem";
            const valuesCell = (l: LineRow) => {
              const stepped = l.value_in_steps;
              const dupValues = duplicateOptions.get(l.key);
              return (
                <div className="max-w-xl rounded-md border border-border bg-surface-muted/40 p-2">
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {stepped ? "Generated values" : "Values"}
                    </span>
                    {!stepped ? (
                      <span className="text-xs text-muted-foreground">
                        these become the dropdown on the Material form
                      </span>
                    ) : l.options_edited ? (
                      /* SAYING WHICH STATE THE LIST IS IN, because the range
                         fields above have silently stopped driving it. Without
                         this the operator edits one value, later corrects Step,
                         sees nothing happen, and has no way to know why. The
                         button is the way back — and it is honest about the cost,
                         since regenerating is exactly what discards the edits. */
                      <>
                        <span className="text-xs text-muted-foreground">
                          edited — Start / End / Step no longer rewrite this list
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-1 py-0 text-xs"
                          onClick={() =>
                            setLines((ls) =>
                              ls.map((x) =>
                                x.key === l.key
                                  ? { ...x, options_edited: false, options: genOptions(x) }
                                  : x,
                              ),
                            )
                          }
                        >
                          Regenerate
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        from Start / End / Step — editing one makes the list yours
                      </span>
                    )}
                  </div>

                  {/* Its OWN grid, not just a stack of inputs. Without these
                      markers each value counted as a column of the outer
                      ATTRIBUTE row, so ↓ from "End Value" landed on the second
                      value of the next attribute line and ↓ inside the list
                      jumped lines instead of walking values (client 2026-07-25).
                      `ownDescendants` in child-grid.tsx scopes by nearest marker,
                      so this also removes them from the outer row's axis. */}
                  <div
                    data-grid-body
                    className="space-y-1"
                    // Both kinds now, because both are editable. A stepped list
                    // used to be read-only text with nothing to focus, so it
                    // needed no grid nav; its rows are real inputs now.
                    onKeyDown={(e) => gridKeyNav(e)}
                  >
                    {stepped && l.options.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Set Start / End / Step on the row above to generate values.
                      </p>
                    )}
                    <>
                        {/* The column header earns its place only once there is
                            a column to head. On an empty list it would be two
                            captions stacked above a button. */}
                        {l.options.length > 0 && (
                          <div
                            className="grid items-center gap-x-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                            style={{ gridTemplateColumns: VALUE_TRACKS }}
                          >
                            <div className="text-center">#</div>
                            <div>Value</div>
                            <div />
                          </div>
                        )}
                        {l.options.map((o, oi) => {
                          const dup = !!dupValues?.has(o.description.trim().toUpperCase());
                          return (
                            // `data-grid-row` on the wrapper, not the grid row: the
                            // duplicate hint below belongs to the same row, and
                            // child-grid finds a row's fields by containment.
                            <div key={o.key} data-grid-row>
                              <div
                                className="grid items-center gap-x-2"
                                style={{ gridTemplateColumns: VALUE_TRACKS }}
                              >
                                <div className="text-center text-xs text-muted-foreground">
                                  {oi + 1}
                                </div>
                                <Input
                                  value={o.description}
                                  uppercase
                                  onChange={(e) => setOptionAt(l.key, o.key, { description: e.target.value })}
                                  aria-invalid={dup ? true : undefined}
                                  className={cn(dup && "border-danger")}
                                />
                                <div className="flex items-center justify-center">
                                  {(
                                    // `data-row-remove` is all this needs: Tab steps
                                    // over every non-field centrally (lib/focus.ts),
                                    // and the marker is what lets Ctrl+Del on this
                                    // value click it.
                                    //
                                    // No per-value Blocked box, though legacy has
                                    // one. It went from stepped rows first — their
                                    // values are derived from Start/End/Step, so the
                                    // way to exclude one is to narrow the range
                                    // (client 2026-07-27) — and the same argument
                                    // finished it for manual lists: the way to
                                    // exclude a value you typed is to remove it
                                    // (client 2026-07-28). `options.blocked` stays in
                                    // the row type, the payload and the DB (0346), so
                                    // a value blocked before that change stays
                                    // blocked rather than being silently re-offered.
                                    !storedOptionKeys.has(o.key) && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      data-row-remove
                                      className="px-1 text-muted-foreground hover:text-danger"
                                      onClick={() => removeOption(l.key, o.key)}
                                      aria-label={`Remove value ${o.description}`.trim()}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                    )
                                  )}
                                </div>
                              </div>
                              {/* Both copies are flagged, not just the later one —
                                  the user is as likely to want to retype the first. */}
                              {dup && (
                                <p className="pl-[3.25rem] text-xs text-danger">
                                  Already listed in this attribute
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {/* A BUTTON, not a permanently open empty box.
                            The values list carried a star row like the attribute
                            grid above it, for symmetry with legacy — but an
                            always-visible blank input in a bordered panel reads
                            as clutter rather than as an invitation, and the
                            client asked for the button back (2026-08-04).

                            "The keyboard is unaffected, because the button was
                            never its path" was said here and was HALF TRUE: Enter
                            off the last value still opens the next box, and Enter
                            on that box while it is still empty declines and moves
                            the operator to the next attribute — but all of that
                            needs the operator to already be INSIDE the list, and
                            with no values there was nothing to stand on. Tab
                            skipped the panel and never lands on a button, so the
                            FIRST value was mouse-only (client 2026-08-05,
                            screenshot 2172).

                            `data-row-add` is the fix, and it is not a local
                            handler: Tab stepping off the row's last column into an
                            empty nested grid clicks the marked button and lands in
                            the box it opens (`enterNestedGrid`, child-grid.tsx).
                            The button keeps its own click, and the box still
                            appears only when it is asked for. */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-row-add
                          className="mt-0.5"
                          onClick={() => addOption(l.key)}
                        >
                          + Add value
                        </Button>
                    </>
                  </div>
                </div>
              );
            };
            // Just the value list now, and rendered DIRECTLY — no `FieldGrid`.
            // Start/End/Unit/Step used to live here as a four-field row on the
            // 12-col track; they are columns on the line itself since the grid
            // went tabular, which is the point of the change. `valuesCell` now
            // draws its own bordered panel and owns its own width, so putting it
            // back on that track would make it one column of twelve.
            const specCell = (l: LineRow) => valuesCell(l);
            /** What a collapsed row shows in place of its value list: how many
             *  values it will offer. The flags are columns now, so they no longer
             *  need restating in words. */
            const valueCount = (l: LineRow) => {
              const n = l.options.filter((o) => o.description.trim()).length;
              return n === 1 ? "1 value" : `${n} values`;
            };
            return (
              // `DetailSection` draws the panel and names it once; the grid inside
              // is `frameless` with no caption of its own, so there is one border
              // and one title rather than a card inside a card. The header strip
              // sits between them — the columns belong to the rows, not to the
              // section, and this is the only place both can see the same track.
              <DetailSection label="Attributes">
                {headerStrip}
                <ChildGrid<LineRow>
                  lockExisting
                label=""
                forceCards
                listRows
                rows={lines}
                // NO BUTTON, AND NO KEY THAT ADDS. Rows appear by filling in the
                // trailing star row (`withStarRow`), which is how the legacy grid
                // works and why it needs no "+ Add" anywhere. `hideAdd` also makes
                // `addFn` = `NO_ADD`, which now DECLINES Enter on the last row —
                // so Enter there advances out of the grid instead of dying.
                hideAdd
                onAdd={() => false}
                onRemove={(l) => removeLine(l.key)}
                // Paging is gone with the tall cards: a line is one row now, so a
                // category with a dozen attributes is a dozen rows — legacy shows
                // them all, and §6 forbids capping the height instead.
                columns={[
                  // `listRows` + `renderMobileRow` mean these never render — they
                  // are the fallback if this grid is ever switched to a table.
                  //
                  // NO `required` on the column, deliberately. That prop is a
                  // COLUMN-level declaration and it reaches the cell through a
                  // `RequiredScope`, which ORs with whatever the control inside
                  // says — so on this grid it could only ever add a hold to the
                  // rows `attrCell` has exempted, starting with the blank
                  // placeholder. Requiredness here is a property of the ROW
                  // (`rowStarted`), so the picker's own `required` is the single
                  // declaration, and it is the one both paths render.
                  { header: "Attribute", cell: attrCell },
                  { header: "Values", cell: valuesCell },
                ]}
                renderMobileRow={(l, i) => {
                  const isOpen = expandedKeys.has(l.key);
                  const dupAttr = !!l.attribute_id && duplicateAttrIds.has(l.attribute_id);
                  const dupValue = (duplicateOptions.get(l.key)?.size ?? 0) > 0;
                  // The star row is the one line that is SUPPOSED to be empty, so
                  // it gets no "#", no chevron and no remove — it is not a record
                  // yet, and offering to delete nothing reads as a bug.
                  //
                  // `!rowStarted` is what keeps that true only while it IS empty.
                  // The moment anything is typed into it, it stops being the
                  // placeholder and becomes a row like any other: numbered,
                  // removable, and with its Attribute mandatory and holding the
                  // cursor (client 2026-08-11). The operator can still walk past
                  // an untouched blank row and reach Save, which is the whole
                  // reason the exemption exists — a permanently-blank row that
                  // held the cursor would put Save out of keyboard reach for
                  // good, and forward movement is exactly what a hold refuses.
                  const isStar =
                    !l.attribute_id && i === lines.length - 1 && !rowStarted(l);
                  return (
                    <div
                      className="space-y-1.5"
                      /**
                       * ONLY THE ROW THE CURSOR IS IN STAYS OPEN (client
                       * 2026-08-04). Moving on to the next attribute left the
                       * previous one's value panel hanging open, so the grid grew
                       * a block of someone else's values between every two rows.
                       *
                       * Driven by FOCUS, not by the chevron: "I have moved on" is
                       * a thing the cursor says, and it covers Tab, the arrows and
                       * the mouse in one rule rather than three. React's onFocus
                       * bubbles, so a click or a Tab anywhere inside this row —
                       * including into its own value list — reports the row and
                       * keeps it open.
                       *
                       * NOT a keyboard handler: it reads where focus landed and
                       * never touches a key, so the contract in lib/focus.ts still
                       * owns every movement (the skill's "never bind keys per
                       * screen" rule).
                       *
                       * The star row is not expandable, so focusing it collapses
                       * everything — which is the reported case: you move to the
                       * new row and the old panel closes behind you.
                       */
                      onFocus={() =>
                        setExpandedKeys((s) => {
                          const keep = s.has(l.key);
                          // Already in the wanted shape — return the SAME set, or
                          // every focus move inside one row re-renders the grid.
                          if (keep ? s.size === 1 : s.size === 0) return s;
                          return keep ? new Set([l.key]) : new Set();
                        })
                      }
                    >
                      <div
                        className="grid items-start gap-x-2"
                        style={{ gridTemplateColumns: ROW_TRACKS }}
                      >
                        {/* ⊟ / ⊞, legacy's expander, in its own leading column.
                            A row with no attribute picked has nothing to show, so
                            the chevron only appears once the row is real. */}
                        <div className="flex min-h-9 items-center justify-center">
                          {!isStar && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(l.key)}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? "Hide values" : "Show values"}
                              className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                        {/* The placeholder marker is NOT an asterisk any more.
                            Legacy's blank line is a `*`, and that is where this
                            came from — but in THIS grid the Attribute beside it
                            carries a real required star, so a `*` in the row
                            number read as "this field is mandatory" while
                            holding nothing at all. That is the `*`-that-holds-
                            nothing trap, and here it did worse than mislead: it
                            advertised a hold on the one row that is exempt, so
                            the cursor moving on looked like the rule failing
                            (client 2026-08-11). `+` says "a new row starts
                            here", which is what the line actually is. */}
                        <div
                          className="flex min-h-9 items-center justify-center text-xs text-muted-foreground"
                          aria-hidden={isStar || undefined}
                        >
                          {isStar ? "+" : i + 1}
                        </div>
                        <div className="min-w-0">
                          {attrCell(l)}
                          {dupAttr && (
                            <p className="mt-1 text-xs text-danger">Already used in this set</p>
                          )}
                          {/* Says why Save is disabled and why the cursor will
                              not move on — so it is gated on `rowStarted`, the
                              same predicate those two read, and never on
                              `isStar`. On a line with nothing on it this
                              sentence would be an error about a row that blocks
                              no save and holds no cursor, and whose "clear this
                              line" is not even offered once the line is a stored
                              one. */}
                          {!l.attribute_id && rowStarted(l) && (
                            <p className="mt-1 text-xs text-danger">
                              Pick an attribute, or clear this line
                            </p>
                          )}
                        </div>
                        {flagCell(l, "value_in_steps")}
                        {numCell(l, "start_value")}
                        {numCell(l, "end_value")}
                        {unitCell(l)}
                        {numCell(l, "step_value")}
                        {flagCell(l, "mandatory")}
                        {flagCell(l, "inactive")}
                        <div className="flex min-h-9 items-center justify-center">
                          {!isStar && !storedLineKeys.has(l.key) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              // `data-row-remove` is what Ctrl+Del drives; Tab
                              // steps over it centrally (lib/focus.ts).
                              data-row-remove
                              className="px-1 text-muted-foreground hover:text-danger"
                              onClick={() => removeLine(l.key)}
                              aria-label="Remove attribute"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* The nested block, indented under its own row exactly as
                          legacy indents its values sub-grid. Collapsed, the row
                          says only how many values it holds — and carries the
                          duplicate complaint, because a duplicate blocks Save and
                          the operator may have folded the offending row away. */}
                      {!isStar &&
                        (isOpen ? (
                          <div className="pb-1 pl-[4.5rem] pr-2">{specCell(l)}</div>
                        ) : (
                          <div className="pl-[4.5rem] text-xs text-muted-foreground">
                            {dupValue ? (
                              <span className="text-danger">Duplicate value</span>
                            ) : (
                              valueCount(l)
                            )}
                          </div>
                        ))}
                    </div>
                  );
                }}
                />
              </DetailSection>
            );
          })()}
          </div>
          )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
