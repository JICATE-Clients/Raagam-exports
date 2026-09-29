"use client";

import { useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
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
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";
import { dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { Truncated } from "@/components/ui/truncated";

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

/**
 * WIDTHS, NOT FRACTIONS (erp-form-compact). The identity row was an
 * `IdentityRow` on `1fr 1.4fr` tracks, so a two-value Item Class stretched to
 * ~480px of a full-screen sheet.
 *
 *   Identity — item class 200 + category 200, 1 × 12 gap = 412
 */
const FIELD_W = {
  item_class: "party", // 200px — "PACKING ACCESSORIES" is the longest class
  category: "party", //   200px — picker trigger + its manage icon
} satisfies Record<string, FieldWidth>;

/**
 * The Attributes panel AND the footer's buttons, from ONE string. The widest
 * row is an attribute line (`ROW_TRACKS` below): 47.5rem of fixed tracks (760)
 * + Attribute at `term` (176) + 10 × 8 gaps (80) = 1016, + 2 × 8 card padding
 * (compact) + 2 × 1 border = 1034.
 *
 * 66rem (1056px) leaves room for the non-compact density and the grid's own
 * row inset, and still clears the 1155px laptop pane. Capped, the Attribute
 * column stops sprawling across a wide monitor (rule 4).
 */
const FORM_W = "max-w-[66rem]";

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
   * THE ATTRIBUTE OPEN IN THE DETAIL PANE (client 2026-09-29, option C of the
   * Material Attribute mock-ups: "apply C"). The editor is a list of attributes
   * on the left and ONE attribute's detail on the right, so "which lines are
   * expanded" (a set, when every line carried its own fold-out value panel)
   * became "which line is selected". `null` falls back to the first line — see
   * `selectedLine` — so a removed selection never leaves the pane empty.
   */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** The value being typed in the selected attribute's end box. */
  const [valueDraft, setValueDraft] = useState<{ lineKey: string; text: string }>({ lineKey: "", text: "" });
  /** The value chip being renamed in place. */
  const [renamingOpt, setRenamingOpt] = useState<{ lineKey: string; optKey: string; text: string } | null>(null);
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

  const pg = usePagination(filtered);

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
    setSelectedKey(first.key);
    setValueDraft({ lineKey: "", text: "" });
    setRenamingOpt(null);
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
    // Open the first attribute in the detail pane (null → `selectedLine` falls
    // back to the first line, which is the "+" row on a record with none).
    setSelectedKey(built[0]?.key ?? null);
    setValueDraft({ lineKey: "", text: "" });
    setRenamingOpt(null);
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
    if (selectedKey === key) setSelectedKey(null);
  };

  /**
   * Picking the attribute is what turns the star row into a real line, so it is
   * also the moment to SELECT it — the detail pane follows the pick.
   *
   * Without this the new row arrived collapsed and the operator had to click its
   * chevron before they could type a single value — "if the user moves to the
   * next attribute it is automatically closed" (client 2026-08-04). Nothing was
   * closing it; it had simply never been opened, which looks identical from the
   * outside. Opening on the pick means the whole flow — pick, type values, move
   * on — never needs the mouse.
   *
   */
  const pickAttribute = (key: string, attributeId: string) => {
    setLineAt(key, { attribute_id: attributeId });
    if (attributeId) setSelectedKey(key);
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
            options: [
              ...l.options,
              // A value typed in the end box but not yet Entered still saves —
              // unless it would repeat one already in the list.
              ...(l.key === valueDraft.lineKey &&
              valueDraft.text.trim() &&
              !l.options.some((o) => o.description.trim().toUpperCase() === valueDraft.text.trim().toUpperCase())
                ? [{ key: "draft", description: valueDraft.text.trim().toUpperCase(), blocked: false }]
                : []),
            ]
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
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged}
        paginate={false} getKey={(r) => r.id} empty="No material attributes yet." />
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
          /* `mr-auto` parks this box at the footer's left, so the buttons end
             where the Attributes panel ends. Same `FORM_W`. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
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
          </div>
        }
      >
        <div className="space-y-3">
          {/* Single column, header ABOVE the attributes (client 2026-07-27).
              This used to be `lg:grid-cols-2` with the header on the left and
              the attribute lines on the right — but the header holds exactly
              two fields, so the left half was empty for the entire height of
              the attributes panel while the panel itself was squeezed into
              ~570px and every line wrapped. Stacking gives the lines the
              width they need (up to FORM_W), which is what lets the picker and
              the three flags share one row instead of three. */}
          {/* The record's IDENTITY, not a section: `(item_class_id,
              category_id)` is the unique key behind
              `uq_material_attributes_class_category` — a band with no border
              and no caption, because the thing that identifies a record needs
              none. (It replaced a `DetailSection label="Header"`, whose caption
              named nothing and whose chrome cost a row of vertical space.)

              A content-width `FieldRow` (widths from FIELD_W above), no longer
              an `IdentityRow` whose fractional tracks stretched both fields
              across the pane. `align="start"` because both fields render a hint
              below the control. */}
          <FieldRow align="start">
            <Field
              label="Item Class"
              w={FIELD_W.item_class}
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
              w={FIELD_W.category}
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
          </FieldRow>

          {/* Attribute lines — meaningless until an Item Class scopes the
              pickable values, so keep the placeholder gate here */}
          <div className="space-y-4">
          {!itemClassId ? (
            <div className={cn("rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-12 text-center text-sm text-muted-foreground", FORM_W)}>
              Select an Item Class above to add its attribute lines.
            </div>
          ) : (
          <div>
          {(() => {
            /**
             * OPTION C — THE ATTRIBUTE LIST AND ONE ATTRIBUTE'S DETAIL (client
             * 2026-09-29, "apply C", the Material Attribute mock-ups). It was an
             * 11-column row per attribute — Start / End / Unit / Step greyed on
             * every line that was not stepped — with each line folding open into
             * a one-value-per-row panel beneath it. Now: the attributes as a list
             * on the left, saying what each holds; the selected one on the right,
             * with only the fields that apply to it.
             *
             * THE DATA RULES ARE UNCHANGED, AND EACH STILL HAS ONE HOME:
             * `withStarRow` (the trailing blank line IS the "+ Pick an attribute"
             * box at the foot of the list), `rowStarted` (the attribute hold and
             * the Save gate), `duplicateAttrIds` / `duplicateOptions`,
             * `options_edited` + Regenerate, and `storedLineKeys` /
             * `storedOptionKeys` (a saved attribute or value has no ✕).
             */
            const norm = (t: string) => t.trim().toUpperCase();
            const starLine = lines[lines.length - 1];
            const isStarLine = (l: LineRow) => l === starLine && !l.attribute_id && !rowStarted(l);
            const realLines = lines.filter((l) => !isStarLine(l));
            const selectedLine =
              lines.find((l) => l.key === selectedKey && !isStarLine(l)) ?? realLines[0] ?? null;

            // The picker ALONE — the hold is keyed on `rowStarted`, never on
            // being the last line; see the history on `rowStarted` above.
            const attrPicker = (l: LineRow) => (
              <AttributePicker
                label="Attribute"
                // `compact`: the picker draws no label and no `*` of its own. In
                // the detail pane the `<Field label="Attribute">` draws both —
                // the picker's own put a second, lone `*` under it (client
                // 2026-09-29); in the list, the hint under the box names it.
                compact
                values={scopedAttributeValues}
                value={l.attribute_id}
                onChange={(v) => pickAttribute(l.key, v)}
                invalid={!!l.attribute_id && duplicateAttrIds.has(l.attribute_id)}
                required={rowStarted(l)}
              />
            );

            const valueCountText = (l: LineRow) => {
              const n = l.options.filter((o) => o.description.trim()).length;
              return n === 1 ? "1 value" : `${n} values`;
            };

            /* ---------------- left: the attribute list ---------------- */
            const list = (
              <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface md:w-72">
                <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Attributes · {realLines.length}
                </div>
                {realLines.map((l) => {
                  const on = selectedLine?.key === l.key;
                  const dupAttr = !!l.attribute_id && duplicateAttrIds.has(l.attribute_id);
                  const dupValue = (duplicateOptions.get(l.key)?.size ?? 0) > 0;
                  return (
                    <button
                      key={l.key}
                      type="button"
                      onClick={() => setSelectedKey(l.key)}
                      aria-current={on || undefined}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm font-medium",
                        on ? "bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]" : "hover:bg-surface-muted",
                      )}
                    >
                      <Truncated className={cn("min-w-0", !l.attribute_id && "text-danger")}>
                        {l.attribute_id ? attrValueLabel.get(l.attribute_id) ?? "—" : "Pick an attribute"}
                      </Truncated>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1 text-[11px] font-semibold">
                        {(dupAttr || dupValue) && (
                          <span className="rounded bg-danger-soft px-1.5 py-0.5 text-danger">Duplicate</span>
                        )}
                        <span className="rounded bg-surface-muted px-1.5 py-0.5 text-muted-foreground">
                          {valueCountText(l)}
                        </span>
                        {l.mandatory && (
                          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">Mandatory</span>
                        )}
                        {l.inactive && (
                          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-muted-foreground">Blocked</span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {/* The star row, as the list's last entry: picking here makes it
                    a real line and opens it on the right (`pickAttribute`). */}
                {isStarLine(starLine) && (
                  <div className="p-3" aria-label="Add an attribute">
                    {attrPicker(starLine)}
                    <p className="mt-1 text-xs text-muted-foreground">Pick an attribute to add it</p>
                  </div>
                )}
              </div>
            );

            /* ---------------- right: one attribute's detail ---------------- */
            const flag = (l: LineRow, field: "value_in_steps" | "mandatory" | "inactive", label: string) => (
              // BLOCKED IS OFF THE TYPING PATH while unticked (client 2026-08-11)
              // — `data-focus-optional` on the wrapper, see lib/focus.ts.
              <div data-focus-optional={field === "inactive" && !l[field] ? "" : undefined}>
                <Toggle
                  label={label}
                  checked={l[field]}
                  onChange={(next) =>
                    field === "value_in_steps"
                      ? patchLine(l.key, { value_in_steps: next })
                      : setLineAt(l.key, { [field]: next })
                  }
                />
              </div>
            );
            const num = (l: LineRow, field: "start_value" | "end_value" | "step_value", label: string) => (
              <Field label={label} w="hug" htmlFor={`ma-${field}`}>
                <Input
                  id={`ma-${field}`}
                  type="number"
                  step="0.0001"
                  className="text-right tabular-nums"
                  value={l[field]}
                  onChange={(e) => patchLine(l.key, { [field]: e.target.value })}
                />
              </Field>
            );

            const valueChips = (l: LineRow) => {
              const dupValues = duplicateOptions.get(l.key);
              const draft = valueDraft.lineKey === l.key ? valueDraft.text : "";
              const draftDup =
                !!norm(draft) && l.options.some((o) => norm(o.description) === norm(draft))
                  ? `"${norm(draft)}" is already in this list. Use a different value.`
                  : null;
              const renaming = renamingOpt?.lineKey === l.key ? renamingOpt : null;
              const renameDup =
                renaming &&
                !!norm(renaming.text) &&
                l.options.some((o) => o.key !== renaming.optKey && norm(o.description) === norm(renaming.text))
                  ? `"${norm(renaming.text)}" is already in this list. Use a different value.`
                  : null;
              const addDraft = () => {
                if (!norm(draft) || draftDup) return;
                setLines((ls) =>
                  ls.map((x) =>
                    x.key === l.key
                      ? {
                          ...x,
                          options_edited: true,
                          options: [...x.options, { key: newOptKey(), description: norm(draft), blocked: false }],
                        }
                      : x,
                  ),
                );
                setValueDraft({ lineKey: l.key, text: "" });
              };
              const commitRename = () => {
                if (!renaming || renameDup) return;
                // Blank keeps the old value — ✕ is how a value goes, never an empty box.
                if (norm(renaming.text)) setOptionAt(l.key, renaming.optKey, { description: norm(renaming.text) });
                setRenamingOpt(null);
              };
              const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              };
              const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setRenamingOpt(null);
                }
              };
              return (
                <div className="space-y-2">
                  {/* NO HEADING ON A PLAIN LIST (client 2026-09-29: the "Values"
                      label and "these become the dropdown on the Material
                      form" both removed — the chips say what they are). A
                      stepped list keeps its line: it says whether Start / End /
                      Step still rewrite the values, and carries Regenerate. */}
                  <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", !l.value_in_steps && "hidden")}>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Generated values
                    </span>
                    {!l.value_in_steps ? null : l.options_edited ? (
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
                                x.key === l.key ? { ...x, options_edited: false, options: genOptions(x) } : x,
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
                  {l.value_in_steps && l.options.length === 0 && (
                    <p className="text-xs text-muted-foreground">Set Start / End / Step above to generate values.</p>
                  )}
                  <div className="flex flex-wrap items-start gap-2">
                    {l.options.map((o) => {
                      const dup = !!dupValues?.has(norm(o.description));
                      if (renaming?.optKey === o.key) {
                        const id = `ma-ren-${o.key}`;
                        return (
                          <div key={o.key} className="w-44">
                            <Input
                              autoFocus
                              uppercase
                              aria-label={`Rename ${o.description}`}
                              value={renaming.text}
                              onChange={(e) => setRenamingOpt({ lineKey: l.key, optKey: o.key, text: e.target.value })}
                              onKeyDown={onRenameKey}
                              onBlur={commitRename}
                              className="h-8 rounded-full"
                              {...dupFieldProps(renameDup, id)}
                            />
                            <DuplicateError error={renameDup} id={id} />
                          </div>
                        );
                      }
                      return (
                        <span
                          key={o.key}
                          className={cn(
                            "inline-flex h-8 items-center gap-0.5 rounded-full border bg-primary-soft pl-3 pr-1 text-sm font-medium",
                            dup ? "border-danger text-danger" : "border-primary text-foreground",
                            storedOptionKeys.has(o.key) && "pr-3",
                          )}
                          title={dup ? "Already listed in this attribute" : undefined}
                        >
                          <button
                            type="button"
                            title="Click to rename"
                            className="cursor-text"
                            onClick={() => setRenamingOpt({ lineKey: l.key, optKey: o.key, text: o.description })}
                          >
                            {o.description || "—"}
                          </button>
                          {/* A SAVED value cannot be removed; one added since can
                              (client 2026-08-10) — `storedOptionKeys`. */}
                          {!storedOptionKeys.has(o.key) && (
                            <button
                              type="button"
                              aria-label={`Remove value ${o.description}`.trim()}
                              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
                              onClick={() => removeOption(l.key, o.key)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                    <div className="min-w-[11rem]">
                      <Input
                        id={`ma-new-value-${l.key}`}
                        uppercase
                        aria-label="New value"
                        placeholder="Type and press Enter"
                        value={draft}
                        onChange={(e) => setValueDraft({ lineKey: l.key, text: e.target.value })}
                        onKeyDown={onDraftKey}
                        className="h-8 rounded-full border-dashed"
                        {...dupFieldProps(draftDup, `ma-new-value-${l.key}`)}
                      />
                      <DuplicateError error={draftDup} id={`ma-new-value-${l.key}`} />
                    </div>
                  </div>
                </div>
              );
            };

            const detail = !selectedLine ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-12 text-center text-sm text-muted-foreground">
                Pick an attribute on the left to start.
              </div>
            ) : (
              <div className="min-w-0 flex-1 space-y-5 rounded-lg border border-border bg-surface p-4">
                {/* ONE ROW: the attribute and its three switches (client
                    2026-09-29: "Value in steps, Mandatory, Blocked … attribute
                    line laye orey row"). `items-end` + an `h-9` switch strip
                    puts the switches on the picker's control line, under the
                    Attribute label's baseline; Remove parks at the far end. */}
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <Field label="Attribute" w="party" required={rowStarted(selectedLine)}>
                    {attrPicker(selectedLine)}
                    {!!selectedLine.attribute_id && duplicateAttrIds.has(selectedLine.attribute_id) && (
                      <p className="mt-1 text-xs text-danger">Already used in this set</p>
                    )}
                    {!selectedLine.attribute_id && rowStarted(selectedLine) && (
                      <p className="mt-1 text-xs text-danger">Pick an attribute, or clear this line</p>
                    )}
                  </Field>
                  <div className="flex h-9 flex-wrap items-center gap-x-6 @2xl/editor:h-8">
                    {flag(selectedLine, "value_in_steps", "Value in steps")}
                    {flag(selectedLine, "mandatory", "Mandatory")}
                    {flag(selectedLine, "inactive", "Blocked")}
                  </div>
                  {!storedLineKeys.has(selectedLine.key) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-auto text-danger"
                      onClick={() => removeLine(selectedLine.key)}
                    >
                      {/* toolbar-size: exempt -- a per-attribute action inside the detail pane, not a header row */}
                      Remove attribute
                    </Button>
                  )}
                </div>
                {/* Only a stepped attribute has a range — shown for it alone,
                    never greyed on the others. */}
                {selectedLine.value_in_steps && (
                  <FieldRow>
                    {num(selectedLine, "start_value", "Start")}
                    {num(selectedLine, "end_value", "End")}
                    {num(selectedLine, "step_value", "Step")}
                    {/* Typed, not a UOM lookup (client 2026-07-28): only ever
                        printed onto the generated values ("10 MM"). */}
                    <Field label="Unit" w="hug" htmlFor="ma-unit">
                      <Input
                        id="ma-unit"
                        uppercase
                        value={selectedLine.unit_label}
                        onChange={(e) => patchLine(selectedLine.key, { unit_label: e.target.value })}
                        placeholder="MM"
                      />
                    </Field>
                  </FieldRow>
                )}
                {valueChips(selectedLine)}
              </div>
            );

            return (
              <div className={cn("flex flex-col gap-4 md:flex-row md:items-start", FORM_W)}>
                {list}
                {detail}
              </div>
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
