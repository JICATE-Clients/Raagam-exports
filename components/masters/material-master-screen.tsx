"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, type FieldSize } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { createMaterial, updateMaterial, deleteMaterial } from "@/lib/masters/material-actions";
import { createSubCategory } from "@/lib/masters/category-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CategoryPicker, ItemPicker } from "@/components/masters/lookup-picker";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid, SectionColumn, IdentityRow } from "@/components/masters/section-grid";
import { ChildGrid } from "@/components/masters/child-grid";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { MobileCardList } from "@/components/masters/mobile-card-list";
import { MaterialViewSheet } from "@/components/masters/material-view-sheet";
import {
  MATERIAL_FORMS,
  MATERIAL_TYPES,
  FABRIC_USING,
  fabricStructureUom,
  resolveUomId,
  itemClassForm,
  isAccessoryClass,
  isMaterialFieldRequired,
  missingRequiredMaterialFields,
  usesNumbersUom,
  type Material,
  type MaterialInput,
  type DetailFieldKey,
  type MaterialFormKey,
} from "@/lib/masters/material-types";
import type { ConfigLookup, Attribute, AttributeValue } from "@/lib/masters/extras-types";
import type { MaterialAttribute } from "@/lib/masters/material-attribute-types";
import {
  showsSubCategories,
  type Category,
  type CategorySubCategory,
} from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { Uom } from "@/lib/masters/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type MixRow = {
  key: string;
  description: string;
  shade: string;
  uom_id: string;
  component_item_id: string;
  count_id: string;
  blend_pct: string;
};
type ConvRow = { key: string; alt_qty: string; alt_uom_id: string; base_qty: string; base_uom_id: string };
type UsingItemRow = { key: string; used_item_id: string; description: string; shade: string; uom_id: string };

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/**
 * A mixing share as it should READ in a composed name.
 *
 * The grid holds the raw string an `<input type="number">` produced, and that is
 * not a number that has been through anything: a typed "050" stays "050", and a
 * legacy row's "45.00" stays "45.00". Straight into the name, that showed the
 * operator `050% 16'S OE COTTON` (client 2026-08-04). Legacy prints `45%`.
 *
 * `Number()` then `String()` is the whole normalisation — it drops leading zeros
 * and trailing zero decimals while leaving a real fraction alone (33.33 stays
 * 33.33). Falls back to the trimmed text if the cell somehow holds a non-number,
 * so a name is never silently emptied by a value the composer could not read.
 */
function pctText(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw.trim();
}

/**
 * THE MIXING PARENTHETICAL, exactly as legacy RP prints it:
 * `(COTTON 45%, POLYSTER 55%)` — each component named first, its share after,
 * comma-separated, wrapped in one pair of brackets.
 *
 * Shared by the Yarn and Fabric branches of `suggestedName`. Fabric has had this
 * shape since 2026-07-23 and Yarn had a different one (`45% COTTON / 55% ...`)
 * until 2026-08-04, which is the drift this helper exists to prevent: two
 * branches of one function composing the same idea two different ways.
 */
function mixingParens(rows: readonly { pct: string; label: string }[]): string {
  return `(${rows.map((m) => `${m.label} ${pctText(m.pct)}%`).join(", ")})`;
}

const BLANK = {
  code: "",
  name: "",
  item_class_id: "",
  hsn_code: "",
  hsn_id: "",
  category_id: "",
  sub_category_id: "",
  item_type_name: "",
  item_base_name: "",
  material_type: "",
  specifications: "",
  short_spec: "",
  count_id: "",
  purity_id: "",
  shade: "",
  fabric_type_id: "",
  fabric_structure_id: "",
  fabric_using: "",
  yarn_type_id: "",
  direct_purchase: false,
  has_alternate_uom: false,
  base_uom_id: "",
  stock_uom_id: "",
  billing_uom_id: "",
  planning_uom_id: "",
  purchase_uom_id: "",
  inactive: false,
};
type Form = typeof BLANK;

export function MaterialMasterScreen({
  rows,
  itemClasses,
  categories,
  counts,
  purities,
  hsnCodes,
  fabricTypes,
  yarnTypes,
  fabricStructures,
  units,
  materialAttributes,
  attributes,
  levies,
  perms,
}: {
  rows: Material[];
  itemClasses: ConfigLookup[];
  categories: Category[];
  counts: ConfigLookup[];
  purities: ConfigLookup[];
  hsnCodes: ConfigLookup[];
  fabricTypes: ConfigLookup[];
  yarnTypes: ConfigLookup[];
  fabricStructures: ConfigLookup[];
  units: Uom[];
  materialAttributes: MaterialAttribute[];
  attributes: Attribute[];
  levies: Levy[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // Read-only view (client 2026-07-28 #9): opening the editor was the only way
  // to look at a material. Holds the row itself — everything the view renders is
  // already loaded on it, so there is nothing to fetch.
  const [viewRow, setViewRow] = useState<Material | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Name of the record as it was when the editor opened — used for the sheet
  // title so it doesn't flicker while the user retypes the Name field.
  const [editName, setEditName] = useState("");
  const [form, setForm] = useState<Form>(BLANK);
  const [mixings, setMixings] = useState<MixRow[]>([]);
  const [conversions, setConversions] = useState<ConvRow[]>([]);
  const [usingItems, setUsingItems] = useState<UsingItemRow[]>([]);
  // Attribute-driven answers (SEW/PACK): keyed by material_attribute_line id (0341).
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const keySeq = useRef(0);
  const newKey = () => `r${keySeq.current++}`;

  const classLabel = useMemo(() => new Map(itemClasses.map((c) => [c.id, c.name])), [itemClasses]);
  const catLabel = useMemo(() => new Map(categories.map((c) => [c.id, c.name ?? "—"])), [categories]);
  // Cascading picker rule (mirrors material-attribute-master-screen.tsx): Category
  // only ever shows rows scoped to the selected Item Class, never the full list.
  const scopedCategories = useMemo(
    () => categories.filter((c) => c.item_class_id === form.item_class_id),
    [categories, form.item_class_id],
  );
  const yarnClassId = useMemo(() => itemClasses.find((c) => c.code?.toUpperCase() === "YARN")?.id ?? null, [itemClasses]);
  const yarnItems = useMemo(() => rows.filter((r) => r.item_class_id === yarnClassId), [rows, yarnClassId]);
  // YARN-scoped (NOT scopedCategories, which follows the form's class) — feeds
  // the Component Yarn picker's full quick-create sheet, which always creates
  // inside the Yarn class regardless of the class being edited.
  const yarnCategories = useMemo(() => categories.filter((c) => c.item_class_id === yarnClassId), [categories, yarnClassId]);
  const structureCodeById = useMemo(() => new Map(fabricStructures.map((s) => [s.id, s.code])), [fabricStructures]);
  // Lowercased keys — UOM codes are data ("kg" vs "KG" both occur); the
  // The active kilogram unit (kg and KGS are the same unit; only one should be
  // active). Yarn defaults to it; null when no kilogram unit is active (then no
  // default is applied, so a deactivated unit is never prefilled).
  const kgUnitId = useMemo(
    () => units.find((u) => u.is_active && ["kg", "kgs"].includes(u.code.toLowerCase()))?.id ?? null,
    [units],
  );
  // The active "Numbers" unit — accessories (SEW/PACK) are counted in numbers, so
  // every UOM defaults to it (client 2026-07-24). Null when none is active.
  const numbersUnitId = useMemo(() => {
    const codes = ["nos", "no", "number", "numbers", "pcs", "pc", "unit", "units"];
    return (
      units.find((u) => u.is_active && codes.includes(u.code.toLowerCase()))?.id ??
      units.find((u) => u.is_active && /number|^nos?$|piece/i.test(u.name))?.id ??
      null
    );
  }, [units]);
  const countLabel = useMemo(() => new Map(counts.map((c) => [c.id, c.name])), [counts]);
  const purityLabel = useMemo(() => new Map(purities.map((p) => [p.id, p.name])), [purities]);
  const fabricTypeLabel = useMemo(() => new Map(fabricTypes.map((t) => [t.id, t.name])), [fabricTypes]);
  const yarnItemName = useMemo(() => new Map(yarnItems.map((y) => [y.id, y.name])), [yarnItems]);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.code, r.name, classLabel.get(r.item_class_id ?? ""), r.hsn_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      itemClass: (r, v) => r.item_class_id === v,
      materialType: (r, v) => r.material_type === v,
      category: (r, v) => r.category_id === v,
    },
    initialFilters: { status: "", itemClass: "", materialType: "", category: "" },
  });

  const pg = usePagination(filtered, 10);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const selectedClassCode = itemClasses.find((c) => c.id === form.item_class_id)?.code ?? null;
  const formKey: MaterialFormKey = itemClassForm(selectedClassCode);
  /** Mandatory fields still blank, by label. Drives the Save button; the same
   *  declaration drives each field's `*` and its cursor hold via
   *  `isMaterialFieldRequired` below. */
  const missingRequired = missingRequiredMaterialFields(form, selectedClassCode);
  /** Shorthand for the `required` prop on a field of this class. */
  const req = (f: keyof MaterialInput) => isMaterialFieldRequired(f, selectedClassCode);
  const formDef = formKey === "A" || formKey === "GEN" || formKey === "C" ? MATERIAL_FORMS[formKey] : null;
  const selectedCategory = categories.find((c) => c.id === form.category_id) ?? null;
  /** The units this fabric MUST use, from its structure (client 2026-08-01):
   *  Circular Knit = KGS alone, Flat Knit = NOS + KGS, Woven = MTR + KGS.
   *
   *  Two plain ids rather than one `{base, alt}` object, and deliberately NOT
   *  memoized: the effect below keys off these, and a fresh object every render
   *  would make that effect re-run forever. Ids are strings, so it doesn't.
   *
   *  `fabricBaseUomId` is null for every non-fabric class, for a fabric whose
   *  structure isn't known yet, and for one whose unit the shop's UOM master
   *  doesn't stock — in all three the fields stay as they are rather than being
   *  blanked, and nothing below locks. */
  const fabricRule =
    formKey === "FABRIC" && form.fabric_structure_id
      ? fabricStructureUom(structureCodeById.get(form.fabric_structure_id))
      : null;
  const fabricBaseUomId = fabricRule ? resolveUomId(units, fabricRule.base) : null;
  const fabricAltUomId =
    fabricRule?.secondary && fabricBaseUomId ? resolveUomId(units, fabricRule.secondary) : null;
  /** Yarn and Fabric each already have their one unit decided for them — Yarn is
   *  always KG (0279 #15), a Fabric's comes from its structure — so the whole
   *  Alternative UOM apparatus is not offered on either (client 2026-08-01):
   *  no checkbox, no conversion grid, no four downstream slots. Base stays, and
   *  is the only thing in the section for those two classes.
   *
   *  Keyed on `formKey`, NOT on `fabricBaseUomId`: a Fabric whose structure is
   *  not picked yet has no derived unit, and gating on that would put the
   *  checkbox back on screen for exactly the fabrics that are still being filled
   *  in — the moment it is least wanted.
   *
   *  UI only. `has_alternate_uom` and the conversions keep being derived (the
   *  fabric effect below) and keep round-tripping through save, so a fabric's
   *  KGS half and any conversion an older record already carries survive
   *  untouched — the minimal-forms rule, same as Budget/Cost Rate and the Using
   *  (Items) grid further down this file. */
  const singleUomClass = formKey === "YARN" || formKey === "FABRIC";
  /**
   * FABRIC USES THE SPLIT LAYOUT, like every other class.
   *
   * It stacked its sections full width for part of 2026-08-04 — "make it three
   * fields per row" — which put Structure · Type · Fabric Type on one line at
   * `sm`. The client reverted it the same day and asked for the split screen
   * back, and the signed-off mockup agrees: `doc/ui/New Material Fabric -
   * Organized Layout.html` is `grid-template-columns:1fr 1fr` at the top level,
   * with Classification's own `.grid2` also `1fr 1fr` — TWO fields per row, so
   * Structure | Type share the first and Fabric Type takes the second.
   *
   * That is the whole reason the flag is gone rather than flipped to `false`: a
   * boolean sitting at `false` invites the next reader to try `true` again. The
   * layout doc is the authority, and it has said two columns since 2026-07-23.
   *
   * The coupling still holds and is why this note stays: sections in a
   * `SectionColumn` (~566px) need `lg` fields, sections across the sheet
   * (~1150px) need `sm`. Change one without the other and you get either two
   * enormous fields or the starved-field bug LAYOUT.md §3 names.
   */
  /** A unit's code for display in the read-only boxes the fabric rule renders
   *  ("KGS", "NOS", "MTR") — same text `uomSelect` puts in its options. */
  const unitCode = (id: string) => units.find((u) => u.id === id)?.code ?? "—";
  /** The unit an existing record is CURRENTLY stored in, when the form is about
   *  to move it somewhere else. Read off the row rather than snapshotted into
   *  state, so it clears by itself once the save lands and `rows` refreshes.
   *
   *  Compared against `form.base_uom_id`, not against the structure's derived
   *  unit: since 2026-08-04 Base is editable on fabric too, so the operator's own
   *  change is now a way for the stored quantities and the label above them to
   *  disagree — and it deserves the same warning the structure prefill gets.
   *  Any class, not just fabric; the notice was only ever fabric-shaped because
   *  fabric was the only thing that could move a unit on its own. */
  const storedBaseUomId = editId ? rows.find((r) => r.id === editId)?.base_uom_id ?? null : null;
  const fabricUomChanged =
    storedBaseUomId && form.base_uom_id && storedBaseUomId !== form.base_uom_id
      ? storedBaseUomId
      : null;
  // Sub-categories created from this form's own "+ Add" row, keyed by category.
  // The server action revalidates, but the refreshed `categories` prop only
  // arrives after router.refresh() resolves — until then the option the user
  // just created would vanish from the list they created it in.
  const [newSubCategories, setNewSubCategories] = useState<CategorySubCategory[]>([]);
  // Sub Category (0349) — shown for the classes that carry a second level
  // (General today) as soon as a Category is picked, whether or not that
  // category already defines one: the list is creatable now, so an empty list is
  // a starting point rather than a dead end (client 2026-07-28). Optional, too —
  // plenty of consumables are just "STATIONERY ▸ PEN" with nothing in between.
  const subCategoryVisible = showsSubCategories(selectedClassCode) && !!form.category_id;
  const subCategoryOptions = useMemo(() => {
    if (!subCategoryVisible || !selectedCategory) return [];
    const stored = selectedCategory.sub_categories ?? [];
    const fresh = newSubCategories.filter(
      (sc) => sc.category_id === selectedCategory.id && !stored.some((s) => s.id === sc.id),
    );
    return [...stored, ...fresh].sort((a, b) => a.sno - b.sno);
  }, [subCategoryVisible, selectedCategory, newSubCategories]);
  // Second segment of the General auto-name.
  const subCategoryName =
    subCategoryOptions.find((sc) => sc.id === form.sub_category_id)?.name ?? null;
  // Child grids are wide tables — they render full-width BELOW the two-column
  // body (Screenshot 2079), so their visibility gates live here rather than
  // inside the per-class detail sections. Yarn Mixing shows for a Mixed-nature
  // Category OR for a Yarn Type that is inherently a blend/combination —
  // Twisted / Doubling / Melange (client 2026-07-24). Fabric attributes hide on
  // Direct Purchase.
  const selectedYarnTypeName =
    yarnTypes.find((y) => y.id === form.yarn_type_id)?.name?.toLowerCase() ?? null;
  const yarnTypeNeedsMixing =
    selectedYarnTypeName === "twisted" ||
    selectedYarnTypeName === "doubling" ||
    selectedYarnTypeName === "melange";
  const yarnMixingVisible =
    formKey === "YARN" &&
    (((selectedCategory?.made ?? null) === "Mixed") || yarnTypeNeedsMixing);
  const fabricAttributesVisible = formKey === "FABRIC" && !form.direct_purchase;

  // Yarn is always traded in KG (0279 #15). Keep every UOM defaulted to KG
  // whenever the item class is Yarn, backfilling any that are still empty. This
  // covers BOTH a fresh Add (class → Yarn) AND opening a legacy yarn material
  // saved before this default (its blank UOMs prefill to KG on open). Only empty
  // fields are filled, so a manual override always survives. formKey is a stable
  // string and the patch never changes it, so this can't loop.
  useEffect(() => {
    if (formKey !== "YARN") return;
    const kgId = kgUnitId;
    if (!kgId) return;
    setForm((f) => {
      const patch: Partial<Form> = {};
      if (!f.base_uom_id) patch.base_uom_id = kgId;
      if (!f.stock_uom_id) patch.stock_uom_id = kgId;
      if (!f.billing_uom_id) patch.billing_uom_id = kgId;
      if (!f.planning_uom_id) patch.planning_uom_id = kgId;
      if (!f.purchase_uom_id) patch.purchase_uom_id = kgId;
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
  }, [formKey, kgUnitId]);

  // Counted classes are stocked/billed/planned/purchased in Numbers: accessories
  // (Sewing/Packing), and Garments, which are handled as pieces (client
  // 2026-07-28). Backfill every empty UOM to the Numbers unit — same
  // fill-blanks-only shape as the Yarn KG default, so a manual override always
  // survives.
  //
  // Guarded by `usesNumbersUom`, NOT `isAccessoryClass`: adding "GAR" to the
  // accessory set would also switch on the attribute-driven naming flow and hand
  // Garments a question grid and a read-only auto-composed Name.
  useEffect(() => {
    if (!usesNumbersUom(selectedClassCode)) return;
    const nId = numbersUnitId;
    if (!nId) return;
    setForm((f) => {
      const patch: Partial<Form> = {};
      if (!f.base_uom_id) patch.base_uom_id = nId;
      if (!f.stock_uom_id) patch.stock_uom_id = nId;
      if (!f.billing_uom_id) patch.billing_uom_id = nId;
      if (!f.planning_uom_id) patch.planning_uom_id = nId;
      if (!f.purchase_uom_id) patch.purchase_uom_id = nId;
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
  }, [selectedClassCode, numbersUnitId]);

  /** The structure `applyFabricStructureUom` below last wrote a unit for.
   *
   *  Primed by `openAdd` / `openEdit`, which is the half that makes the rule a
   *  PREFILL rather than the overwrite it used to be: without it, opening a
   *  saved fabric would look like a structure change and stamp the derived unit
   *  over whatever is stored — silently reverting the override the field now
   *  exists to allow, on a record nobody had even edited. */
  const appliedStructureRef = useRef<string | null>(null);

  // A FABRIC'S BASE UNIT IS PREFILLED FROM ITS STRUCTURE, AND STAYS EDITABLE
  // (client 2026-08-04). Circular Knit starts on KGS, Flat Knit on NOS, Woven on
  // MTR — the pairing `doc/recording/business logic.md` records, where a collar
  // is counted in pieces and costed by weight.
  //
  // It used to OVERWRITE, every render, with the field rendered read-only beside
  // it: "for fabric there is no such thing as a manual override any more"
  // (2026-08-01). That is what changed. The unit now follows the STRUCTURE and
  // nothing else, so:
  //
  //   - picking a structure, or changing it, moves the unit — which is the only
  //     thing "the structure decides it" can mean once the field is editable;
  //   - a hand override afterwards survives every re-render, every unrelated
  //     field, and reopening the record;
  //   - and it is deliberately NOT the fill-blanks-only shape the Yarn and
  //     Numbers effects above use. Blanks-only would leave a fabric switched
  //     from Circular to Woven still showing KGS, i.e. the previous structure's
  //     answer, which is worse than either rule on its own.
  //
  // The four downstream slots are NOT written here any more: `uomSlots()`
  // (lib/masters/material-actions.ts) already points stock/billing/planning/
  // purchase at the base whenever `has_alternate_uom` is off, server-side, for
  // every class. Writing them here too was a second copy of one rule.
  //
  // `has_alternate_uom` and the conversion row's UNITS still follow the
  // structure — that pairing is the thing being preserved, and its UI is hidden
  // on a `singleUomClass` so nothing else can set it. The QUANTITIES stay the
  // operator's: how many kilos a knitted panel weighs is per-material. The
  // server reconciles the row's base against whatever base actually saved.
  useEffect(() => {
    if (formKey !== "FABRIC") return;
    const structureId = form.fabric_structure_id || null;
    if (structureId === appliedStructureRef.current) return;
    // A structure whose unit the shop's UOM master does not stock resolves to
    // null. Leave everything alone rather than blanking a saved unit — and do
    // NOT record it as applied, so the prefill still lands if the unit is added.
    const baseId = fabricBaseUomId;
    if (!baseId) return;
    appliedStructureRef.current = structureId;
    const altId = fabricAltUomId;
    setForm((f) => {
      const patch: Partial<Form> = {};
      if (f.base_uom_id !== baseId) patch.base_uom_id = baseId;
      if (f.has_alternate_uom !== !!altId) patch.has_alternate_uom = !!altId;
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
    setConversions((xs) => {
      // Circular Knit has no alternative — drop any row a structure change left
      // behind, the same way un-ticking the box does.
      if (!altId) return xs.length ? [] : xs;
      // Exactly one row, units fixed. A fabric converted from a structure that
      // had a different pair keeps its quantities; they are the material's
      // weight-per-piece, which the label on the unit did not change.
      const first = xs[0] ?? { key: newKey(), alt_qty: "", alt_uom_id: "", base_qty: "", base_uom_id: "" };
      if (xs.length === 1 && first.alt_uom_id === altId && first.base_uom_id === baseId) return xs;
      return [{ ...first, alt_uom_id: altId, base_uom_id: baseId }];
    });
  }, [formKey, form.fabric_structure_id, fabricBaseUomId, fabricAltUomId]);

  // ── Attribute-driven questions (SEW/PACK, 0341) ────────────────────────────
  // Every attribute_value across all item classes, by id (a line points at one).
  const attributeValueById = useMemo(
    () => new Map<string, AttributeValue>(attributes.flatMap((a) => a.values.map((v) => [v.id, v] as const))),
    [attributes],
  );
  // The material_attributes set configured for the picked (Item Class + Category).
  const matchedAttrSet = useMemo(
    () =>
      materialAttributes.find(
        (m) => m.item_class_id === form.item_class_id && m.category_id === form.category_id,
      ) ?? null,
    [materialAttributes, form.item_class_id, form.category_id],
  );
  // Sewing/Packing accessories are named from their configured attribute
  // questions rather than typed by hand.
  //
  // The `user_defined === false` half is now a formality and is kept on purpose.
  // "User Defined" used to be a Yes/No on the Category — Yes meaning "name this
  // by hand" — but the client dropped the question entirely (2026-07-30) and it
  // is no longer asked anywhere. No row has ever held `true` (0 of 19 categories,
  // 0 items), and with the field gone from both Category forms nothing can set
  // one, so this reads as `true` for every category and the flow is effectively
  // unconditional. It stays readable rather than collapsed for two reasons: the
  // column is still there pending the full-delete decision, and a category can
  // be flipped by SQL if that decision reverses. Note the strict `=== false` —
  // with no category picked yet this is false, which is what keeps the Name
  // editable and the questions hidden until one is chosen.
  //
  // The server never consulted the flag at all: material-actions.ts gates
  // mandatory-answer enforcement on the class code alone, so a category set to
  // Yes was in fact unsaveable.
  const attributeDriven = isAccessoryClass(selectedClassCode) && selectedCategory?.user_defined === false;
  // The attribute-driven category has no configured question set yet.
  const attributeSetMissing = attributeDriven && !matchedAttrSet;
  // The ordered questions to render. Each question's shape comes from its LINE
  // (0346): Value-In-Steps → numeric range/step; otherwise the line's own value
  // list. The attribute VALUE only supplies the question label.
  const attrQuestions = useMemo(() => {
    if (!attributeDriven || !matchedAttrSet) return [];
    return [...matchedAttrSet.lines]
      .filter((l) => !l.inactive && l.attribute_id)
      .sort((a, b) => a.sno - b.sno)
      .map((l) => {
        const av = l.attribute_id ? attributeValueById.get(l.attribute_id) : undefined;
        return {
          lineId: l.id,
          sno: l.sno,
          label: av?.value ?? "Attribute",
          valueInSteps: l.value_in_steps,
          options: (l.options ?? []).filter((o) => !o.blocked).map((o) => o.description),
          mandatory: l.mandatory,
          start: l.start_value,
          end: l.end_value,
          step: l.step_value,
          // Unit label appended to each generated step value (e.g. "50 KGS").
          // Free text since 0350 — the Unit was a UOM-master dropdown but is
          // only ever printed, never converted by (client 2026-07-28). Falls
          // back to the linked UOM's name for lines configured before that.
          unitLabel:
            l.unit_label?.trim() ||
            (l.unit_id ? units.find((u) => u.id === l.unit_id)?.name ?? "" : ""),
        };
      });
  }, [attributeDriven, matchedAttrSet, attributeValueById, units]);
  const attrSeparator = matchedAttrSet?.name_separator ?? " ";
  const attrMandatoryMissing = attrQuestions.some((q) => q.mandatory && !(answers[q.lineId] ?? "").trim());
  // Discrete values for a Value-In-Steps line (client 2026-07-25): the START
  // value first, then every step-multiple (step, 2×step, 3×step …) that is above
  // start and ≤ end. e.g. (1,100,50) → 1, 50, 100 ; (1,10,2) → 1, 2, 4, 6, 8, 10.
  const stepValues = (start: number | null, end: number | null, step: number | null): number[] => {
    if (start == null || end == null || !step || step <= 0 || end < start) return [];
    const out: number[] = [Number(start.toFixed(4))];
    for (let k = 1; k * step <= end + 1e-9 && out.length < 1000; k++) {
      const v = Number((k * step).toFixed(4));
      if (v > start) out.push(v);
    }
    return out;
  };
  // Fabric Structure comes from the Category (0279 #17/#18) — picking a category
  // sets category_id and derives the fabric_structure_id off that row. It no
  // longer touches the UOMs: the structure is the only input to that rule now,
  // so setting it here is the whole job and the effect above does the rest.
  // Duplicating the UOM write here would be a second place to keep in step, and
  // the effect covers the cases this handler cannot (opening an existing fabric,
  // a category whose structure was changed in the Category master).
  function handleFabricCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId) ?? null;
    set({ category_id: categoryId, fabric_structure_id: cat?.fabric_structure_id ?? "" });
  }
  // Melange (yarn OR fabric type) carries a Shade (client 2026-07-23) — the
  // input only shows for Melange, so clear it when the type moves away from
  // Melange to keep a hidden stale shade from persisting on the record.
  function handleYarnTypeChange(v: string) {
    const isMelange = yarnTypes.find((y) => y.id === v)?.name?.toLowerCase() === "melange";
    set({ yarn_type_id: v, ...(isMelange ? {} : { shade: "" }) });
  }
  function handleFabricTypeChange(v: string) {
    const isMelange = fabricTypeLabel.get(v)?.toLowerCase() === "melange";
    set({ fabric_type_id: v, ...(isMelange ? {} : { shade: "" }) });
  }
  // Item Class change: reset the (class-scoped) Category. Yarn's kg UOM defaults
  // are applied by the effect above (fires when formKey becomes YARN), so they
  // no longer need to be duplicated here.
  //
  // Accessories (Sewing/Packing) pre-select Purchased: a thread or a button is
  // bought in, and Converted is the rare exception the operator can still pick
  // (client 2026-07-28). Only fills an EMPTY Transaction Type, so re-picking the
  // class on a record that already says Converted doesn't overwrite it. General
  // no longer shows the field at all and `submit` sends Purchased for it.
  function handleItemClassChange(v: string) {
    const code = itemClasses.find((c) => c.id === v)?.code ?? null;
    set({
      item_class_id: v,
      category_id: "",
      sub_category_id: "",
      ...(isAccessoryClass(code) && !form.material_type ? { material_type: "Purchased" } : {}),
    });
  }

  /** "+ Add" from the Sub Category list. Creates the row, keeps it in local
   *  state so it is selectable immediately (the refreshed `categories` prop is a
   *  round-trip away), and returns the new id for the combobox to select. */
  const createSubCategoryInline = useCallback(
    async (name: string): Promise<string | null> => {
      const categoryId = form.category_id;
      if (!categoryId) return null;
      const res = await createSubCategory(categoryId, name);
      if (!res.ok) {
        error(res.error);
        return null;
      }
      setNewSubCategories((xs) => [
        ...xs,
        // sno 999: appended after everything the Category master defined,
        // matching where the server's next-sno insert actually put it.
        { id: res.id, category_id: categoryId, sno: 999, name: name.trim().toUpperCase() },
      ]);
      router.refresh();
      return res.id;
    },
    [form.category_id, error, router],
  );

  function openAdd() {
    setEditId(null);
    setEditName("");
    // A blank form has no structure yet, so the prefill effect is armed: the
    // first structure the operator picks writes its unit.
    appliedStructureRef.current = null;
    setForm(BLANK);
    setMixings([]);
    setConversions([]);
    setUsingItems([]);
    setAnswers({});
    setOpen(true);
  }
  function openEdit(r: Material) {
    setEditId(r.id);
    setEditName(r.name);
    // The stored record already answers for this structure — whether by the
    // prefill or by a hand override — so the effect must not re-derive on open.
    // It re-arms the moment the operator changes the structure.
    appliedStructureRef.current = r.fabric_structure_id ?? null;
    setForm({
      code: r.code,
      name: r.name,
      item_class_id: r.item_class_id ?? "",
      hsn_code: r.hsn_code ?? "",
      hsn_id: r.hsn_id ?? "",
      category_id: r.category_id ?? "",
      sub_category_id: r.sub_category_id ?? "",
      item_type_name: r.item_type_name ?? "",
      item_base_name: r.item_base_name ?? "",
      material_type: r.material_type ?? "",
      specifications: r.specifications ?? "",
      short_spec: r.short_spec ?? "",
      count_id: r.count_id ?? "",
      purity_id: r.purity_id ?? "",
      shade: r.shade ?? "",
      fabric_type_id: r.fabric_type_id ?? "",
      fabric_structure_id: r.fabric_structure_id ?? "",
      fabric_using: r.fabric_using ?? "",
      yarn_type_id: r.yarn_type_id ?? "",
      direct_purchase: r.direct_purchase,
      has_alternate_uom: r.has_alternate_uom,
      base_uom_id: r.base_uom_id ?? "",
      stock_uom_id: r.stock_uom_id ?? "",
      billing_uom_id: r.billing_uom_id ?? "",
      planning_uom_id: r.planning_uom_id ?? "",
      purchase_uom_id: r.purchase_uom_id ?? "",
      inactive: !r.is_active,
    });
    setMixings(
      r.mixings.map((m) => ({
        key: newKey(),
        description: m.description ?? "",
        shade: m.shade ?? "",
        uom_id: m.uom_id ?? "",
        component_item_id: m.component_item_id ?? "",
        count_id: m.count_id ?? "",
        blend_pct: m.blend_pct != null ? String(m.blend_pct) : "",
      })),
    );
    // Same seed as picking "Using" (handleFabricUsingChange): a fabric that
    // declares a composition re-opens with row 1 present rather than an empty
    // grid it was never possible to save empty from. addMix appends functionally,
    // so it lands on top of the rows just set; normMixings drops it again if the
    // user leaves it untouched.
    const openedClassCode = itemClasses.find((c) => c.id === r.item_class_id)?.code ?? null;
    if (
      itemClassForm(openedClassCode) === "FABRIC" &&
      r.fabric_using &&
      !r.direct_purchase &&
      r.mixings.length === 0
    ) {
      addMix();
    }
    setConversions(
      r.conversions.map((c) => ({
        key: newKey(),
        alt_qty: c.alt_qty != null ? String(c.alt_qty) : "",
        alt_uom_id: c.alt_uom_id ?? "",
        base_qty: c.base_qty != null ? String(c.base_qty) : "",
        base_uom_id: c.base_uom_id ?? "",
      })),
    );
    setUsingItems(
      r.using_items.map((u) => ({
        key: newKey(),
        used_item_id: u.used_item_id ?? "",
        description: u.description ?? "",
        shade: u.shade ?? "",
        uom_id: u.uom_id ?? "",
      })),
    );
    setAnswers(
      Object.fromEntries(
        (r.item_attribute_values ?? [])
          .filter((a) => a.attribute_line_id)
          .map((a) => [a.attribute_line_id as string, a.value ?? ""]),
      ),
    );
    setOpen(true);
  }

  // grid mutators
  const addMix = () =>
    setMixings((xs) => [
      ...xs,
      { key: newKey(), description: "", shade: "", uom_id: "", component_item_id: "", count_id: "", blend_pct: "" },
    ]);
  const setMix = (key: string, patch: Partial<MixRow>) => setMixings((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Mixing % must never accept more than 100% total (client 2026-07-24). Keep the
  // raw text (so partial/decimal entry like "12." still types) unless this cell
  // would push the blend over 100 — then cap it to the remaining budget.
  const setMixPct = (key: string, raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) {
      setMix(key, { blend_pct: raw });
      return;
    }
    const others = mixings.reduce(
      (s, r) => (r.key === key ? s : s + (numOrNull(r.blend_pct) ?? 0)),
      0,
    );
    const max = Math.max(0, 100 - others);
    setMix(key, { blend_pct: n > max ? String(max) : raw });
  };
  const mixPctSum = mixings.reduce((sum, m) => sum + (numOrNull(m.blend_pct) ?? 0), 0);
  // Yarn-dyed fabric: the yarns are already dyed before knitting/weaving, so the
  // Attributes grid only lists WHICH yarns go in — a Mixing % doesn't apply.
  // Matched by label so "Yarn Dyed" / "Yarn-dyed" lookup spellings all work.
  const fabricTypeName = (fabricTypeLabel.get(form.fabric_type_id) ?? "").toLowerCase();
  const isYarnDyedFabric = formKey === "FABRIC" && fabricTypeName.includes("yarn") && fabricTypeName.includes("dyed");
  // Single Yarn fabric (client 2026-07-23 #9): exactly one component, implicitly
  // 100% — no Mixing % column and no second row. If the user flips Using to
  // Single Yarn while multiple filled rows exist, the rows are kept (no silent
  // data loss) and the overflow blocks Save instead.
  const isSingleYarnFabric = formKey === "FABRIC" && form.fabric_using === "Single Yarn";
  const singleYarnOverflow =
    isSingleYarnFabric && mixings.filter((m) => m.component_item_id || m.description.trim()).length > 1;
  // The Mixing % must add up to exactly 100 to save — mirror the server's Zod
  // refine (lib/masters/material-types.ts) client-side so an off total (over OR
  // under 100) blocks Save with the red badge, instead of only failing on submit.
  // Only applies where the % column is actually used: hidden for yarn-dyed and
  // single-yarn fabric, and for yarn when the Mixing grid isn't showing.
  const mixPctApplies =
    !(formKey === "YARN" && !yarnMixingVisible) && !(isYarnDyedFabric || isSingleYarnFabric);
  const mixPctSumInvalid =
    mixPctApplies &&
    mixings.some((m) => numOrNull(m.blend_pct) != null) &&
    Math.abs(mixPctSum - 100) >= 0.01;
  // A Fabric IS its yarn composition, so it cannot be saved without one — the
  // rule and its Direct Purchase carve-out live in fabricCompositionError
  // (lib/masters/material-actions.ts); this mirrors it so Save says why it is
  // off instead of bouncing off the server. Gated on fabricAttributesVisible,
  // which is exactly the "Fabric and not Direct Purchase" test — a grid that
  // isn't on screen must never be what blocks Save.
  const fabricCompositionMissing = fabricAttributesVisible && !mixings.some((m) => m.component_item_id);
  const delMix = (key: string) => setMixings((xs) => xs.filter((r) => r.key !== key));
  const addConv = () => setConversions((xs) => [...xs, { key: newKey(), alt_qty: "", alt_uom_id: "", base_qty: "", base_uom_id: "" }]);
  const setConv = (key: string, patch: Partial<ConvRow>) => setConversions((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delConv = (key: string) => setConversions((xs) => xs.filter((r) => r.key !== key));
  /** Alternative UOM declares that this material is bought in a different unit
   *  than it is consumed in. ON seeds a first conversion row so the revealed
   *  grid isn't an empty box the user has to click "+ Add" to use; OFF clears
   *  the rows so nothing invisible is carried to the server (which enforces the
   *  same rule in normConversions). Mirrors toggleHasSubs in
   *  process-master-screen.tsx. */
  const toggleAltUom = (checked: boolean) => {
    set({ has_alternate_uom: checked });
    if (checked) {
      if (conversions.length === 0) addConv();
    } else {
      setConversions([]);
    }
  };
  /** Fabric "Using" declares that this fabric HAS a composition, so the
   *  Attributes (Mixing) grid is the very next thing to fill. Seed its first row
   *  on pick, so the grid isn't an empty box the user has to click "+ Add" to
   *  use — and Single Yarn is capped at that one row (hideAdd below), so the
   *  click was pure ceremony for the only row it will ever have. Same shape as
   *  toggleAltUom above.
   *
   *  Clearing back to "— None —" deliberately LEAVES the rows: they are the
   *  composition, not an artefact of this dropdown (Direct Purchase is the
   *  switch that clears them), and normMixings drops a row that was never
   *  filled, so a seeded-and-abandoned row never reaches the DB. */
  const handleFabricUsingChange = (v: string) => {
    set({ fabric_using: v });
    if (v && mixings.length === 0) addMix();
  };
  // No add/edit/remove handlers: the Using (Items) grid is gone from the form.
  // `usingItems` is still loaded and saved so legacy rows round-trip untouched.

  function submit() {
    startTransition(async () => {
      const payload: MaterialInput = {
        // Blank on create → the action generates the code (Short Name) from the
        // Name; edit passes the stored code through unchanged.
        code: form.code,
        name: form.name.trim() || null,
        is_active: !form.inactive,
        item_class_id: form.item_class_id || null,
        hsn_code: form.hsn_code || null,
        hsn_id: form.hsn_id || null,
        category_id: form.category_id || null,
        // Only ever sent when the field is actually on screen — otherwise a
        // stale pick would survive a category change that hid the field.
        sub_category_id: (subCategoryVisible && form.sub_category_id) || null,
        item_type_name: form.item_type_name.trim() || null,
        item_base_name: form.item_base_name.trim() || null,
        // General never shows the Transaction Type — a consumable is always
        // bought, so it is saved silently rather than asked (client 2026-07-28).
        material_type: formKey === "GEN" ? "Purchased" : form.material_type || null,
        // Mirrors the Category rather than being edited here; the server
        // re-derives it authoritatively, so this is only a best-effort value.
        user_defined: selectedCategory?.user_defined ?? false,
        specifications: form.specifications || null,
        short_spec: form.short_spec || null,
        count_id: form.count_id || null,
        purity_id: form.purity_id || null,
        shade: form.shade || null,
        fabric_type_id: form.fabric_type_id || null,
        fabric_structure_id: form.fabric_structure_id || null,
        fabric_using: form.fabric_using || null,
        yarn_type_id: form.yarn_type_id || null,
        direct_purchase: form.direct_purchase,
        has_alternate_uom: form.has_alternate_uom,
        base_uom_id: form.base_uom_id || null,
        // ON A `singleUomClass` THE FOUR SLOTS ARE SENT AS NULL, so `uomSlots`
        // (lib/masters/material-actions.ts) derives them from the base. Yarn and
        // Fabric render no UI for them, so any value the form still holds is a
        // stale load, not an answer — and on a Flat Knit or Woven fabric, where
        // `has_alternate_uom` is on, `uomSlots` would have HONOURED that stale
        // value: overriding a saved fabric's Base from NOS to KGS would move the
        // base and leave stock/billing/planning/purchase on NOS. That is only
        // reachable since Base became editable (2026-08-04), which is why the
        // old code did not need this.
        ...(singleUomClass
          ? { stock_uom_id: null, billing_uom_id: null, planning_uom_id: null, purchase_uom_id: null }
          : {
              stock_uom_id: form.stock_uom_id || null,
              billing_uom_id: form.billing_uom_id || null,
              planning_uom_id: form.planning_uom_id || null,
              purchase_uom_id: form.purchase_uom_id || null,
            }),
        // Budget + Cost Rate are no longer edited on this screen (0279 #19).
        // Sent as null to satisfy the input type; the server drops them from
        // the written row so existing values on the record are preserved.
        cost_head_id: null,
        budget_rate: null,
        budget_rate_uom_id: null,
        // A yarn with no Mixing grid showing (not a Mixed category and not a
        // Twisted/Doubling/Melange type) has no blend — don't persist rows the
        // user can no longer see (e.g. left over after switching yarn type).
        mixings: (formKey === "YARN" && !yarnMixingVisible ? [] : mixings).map((m) => ({
          sno: 0,
          description: m.description || null,
          shade: m.shade || null,
          uom_id: m.uom_id || null,
          component_item_id: m.component_item_id || null,
          count_id: m.count_id || null,
          // Yarn-dyed fabric has no Mixing %, and Single Yarn is implicitly
          // 100% — null both so no stale hidden value is stored and the Zod
          // sum-to-100 refine doesn't fire.
          blend_pct: isYarnDyedFabric || isSingleYarnFabric ? null : numOrNull(m.blend_pct),
        })),
        conversions: conversions.map((c) => ({
          sno: 0,
          alt_qty: numOrNull(c.alt_qty),
          alt_uom_id: c.alt_uom_id || null,
          base_qty: numOrNull(c.base_qty),
          base_uom_id: c.base_uom_id || null,
        })),
        using_items: usingItems.map((u) => ({
          sno: 0,
          used_item_id: u.used_item_id || null,
          description: u.description || null,
          shade: u.shade || null,
          uom_id: u.uom_id || null,
        })),
        item_attribute_values: attrQuestions
          .filter((q) => (answers[q.lineId] ?? "").trim())
          .map((q, i) => ({ sno: i + 1, attribute_line_id: q.lineId, value: (answers[q.lineId] ?? "").trim() })),
      };
      const res = editId ? await updateMaterial(editId, payload) : await createMaterial(payload);
      if (res.ok) {
        success(editId ? "Material updated." : "Material added.");
        setOpen(false);
        router.refresh();
      } else error(res.error);
    });
  }

  function remove(r: Material) {
    startTransition(async () => {
      const res = await deleteMaterial(r.id);
      if (res.ok) {
        success(deletedToast("Material", res));
        router.refresh();
      } else error(res.error);
    });
  }

  // UOM options show just the short code (client 2026-07-23 #5) — "KG",
  // not "KG — KGS".
  //
  // `limitTo` narrows the list to a specific set of unit ids instead of the whole
  // active UOM master. Used by the five slot fields once Alternative UOM is on:
  // the conversion rows above them have already named the only units this
  // material deals in, so offering all ~40 again is asking the same question
  // twice and invites a Purchase Uom that no conversion can reach (client
  // 2026-07-28). The current value is always kept in the list, or editing an old
  // record would silently drop a unit that is no longer offered.
  //
  // Still a <Select> while the rest of this form is pickers, and not by
  // oversight: the `uoms` master has no picker in this codebase, and the one
  // written for it would have to carry `limitTo` — a list narrowed by ANOTHER
  // field's rows, which no existing picker does. That is a new shared component
  // plus a decision about what "+ Add" means when the list is deliberately
  // restricted (a unit added inline would sit outside every conversion row and
  // reintroduce exactly the unreachable Purchase Uom the limit was added to
  // prevent), not a swap. Left as-is until UOM gets a picker of its own.
  //
  // `usedIds` is the pick-once rule for the conversion grid: a unit already on
  // another conversion row is offered greyed and tagged, not picked twice. Same
  // rule and same look as `usedIds` on components/ui/data-picker.tsx — this side
  // spells it `<option disabled>`, which `parseOptions` (select.tsx) now carries
  // through to the desktop Combobox instead of dropping.
  const uomSelect = (
    value: string,
    onChange: (v: string) => void,
    limitTo?: Set<string>,
    usedIds?: Iterable<string>,
  ) => {
    const used = new Set(usedIds ?? []);
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="text-base md:text-sm">
        <option value="">— None —</option>
        {units
          .filter((u) => (limitTo ? limitTo.has(u.id) : u.is_active) || u.id === value)
          .map((u) => (
            // Never the row's OWN value — it would refuse what it is showing.
            <option key={u.id} value={u.id} disabled={u.id !== value && used.has(u.id)}>
              {u.code}
              {u.id !== value && used.has(u.id) ? " (already added)" : ""}
            </option>
          ))}
      </Select>
    );
  };

  /** Every unit named in the conversion rows — both sides, since a row reads
   *  "12 DOZ = 1 NOS" and either end is a unit this material is handled in.
   *  This is the pick-list for the five UOM slots below. */
  const convUnitIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversions) {
      if (c.alt_uom_id) ids.add(c.alt_uom_id);
      if (c.base_uom_id) ids.add(c.base_uom_id);
    }
    return ids;
  }, [conversions]);
  // Only narrow once the rows actually name something. An empty set would leave
  // every slot with nothing but "— None —" the instant the box is ticked, which
  // reads as a broken form rather than as "fill the conversion first".
  //
  // And never on a `singleUomClass`, where Base is the only UOM field left on
  // screen: a legacy Yarn carrying a CONE↔KG conversion would otherwise find its
  // Base dropdown silently cut to those two units, while the line that explains
  // the narrowing ("Fill a conversion row above…") sits inside a block that no
  // longer renders. A cage is only fair when its bars are visible.
  const uomLimit =
    form.has_alternate_uom && !singleUomClass && convUnitIds.size > 0 ? convUnitIds : undefined;

  /**
   * How wide each Classification field should be, on the 12-column track.
   *
   * Sized to the data, not to the grid: Count is "40'S", Purity is a word —
   * neither needs the half-row they used to get (client 2026-07-24 #3).
   * Description is the only genuinely long free text. Adjust here, not at the
   * call sites — this map is the single source of truth for the generic classes
   * (General / SEW / PACK / CAP / Garments).
   *
   * A ROW MUST NOT EXCEED 12. A General material shows Category, Sub Category,
   * Item Type and Item Name; at 4+4+3+3 = 14 they overflowed the track and the
   * last field wrapped onto a row of its own, with the empty rest of that row
   * under it (client 2026-07-28). Sizing each to what it actually holds lands on
   * exactly 12:
   *   form GEN — Category 4 + Sub Category 3 + Item Type 2 + Item Name 3 = 12
   * That leaves 5 to split between the two General fields, and Item Name
   * ("NYLON 4 INCH") is the longer of the pair, so it takes 3 and Item Type
   * ("BRUSH", "PEN") takes 2. Widen one of these and something else has to give.
   *
   * The other two forms now sit UNDER 12 and that is fine — the failure mode was
   * overflow, never a short row. Since "User defined" was dropped
   * (client 2026-07-30) form A is Category 4 + Type 3 = 7 (sub-category filters
   * out for every class in A) and form C is Category 4 alone.
   */
  const DETAIL_FIELD_SIZE: Record<DetailFieldKey, FieldSize> = {
    category_id: "md", // 4 — picker, holds the longest value of the four
    sub_category_id: "sm", // 3 — second level under the category, General only
    item_type_name: "xs", // 2 — General only: BRUSH, PEN, CABLE
    item_base_name: "sm", // 3 — General only: the specific item, NYLON 4 INCH
    material_type: "sm", // 3 — Purchased / Converted / Production
    specifications: "lg", // free-text description
    short_spec: "md",
    count_id: "sm", // "40'S", "20'S/2"
    purity_id: "sm", // one word — Combed, Carded
    shade: "sm",
  };

  function detailField(key: DetailFieldKey): ReactNode {
    return (
      <Field key={key} size={DETAIL_FIELD_SIZE[key]}>
        {detailControl(key)}
      </Field>
    );
  }

  function detailControl(key: DetailFieldKey): ReactNode {
    switch (key) {
      case "category_id":
        return (
          <CategoryPicker
            key={key}
            label="Category"
            // Every class requires a Category — it is in all five entries of
            // `REQUIRED_BY_FORM` — but this path, which renders the WHOLE
            // Classification section for General, Sewing/Packing and Capital
            // Goods, passed `required` to nothing. Those classes showed no `*`
            // and held no cursor while Save was already blocked on the field
            // (client 2026-08-04). Yarn and Fabric were wired directly and so
            // looked correct, which is why only these three drifted.
            required={req("category_id")}
            categories={scopedCategories}
            value={form.category_id}
            // A sub-category belongs to one category — changing the category
            // must drop the old pick, or the material keeps a sub-category from
            // a category it is no longer in.
            onChange={(v) => set({ category_id: v, sub_category_id: "" })}
            itemClassId={form.item_class_id}
            selectedClassCode={selectedClassCode}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
            levies={levies}
            fabricStructures={fabricStructures}
          />
        );
      case "material_type": {
        // For Sewing/Packing this is the accessory "Transaction Type" — Production
        // is removed, leaving Purchased / Converted (client 2026-07-24).
        const isAccessory = isAccessoryClass(selectedClassCode);
        const typeOptions = isAccessory ? MATERIAL_TYPES.filter((t) => t !== "Production") : MATERIAL_TYPES;
        return (
          <div key={key}>
            <Label>{isAccessory ? "Transaction Type" : "Type"}</Label>
            <Select value={form.material_type} onChange={(e) => set({ material_type: e.target.value })} className="text-base md:text-sm">
              <option value="">— Select —</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        );
      }
      case "sub_category_id":
        // Optional and creatable (client 2026-07-28 #10/#15). It used to be a
        // mandatory <Select> that only appeared once the Category already
        // defined a second level, so meeting a new one mid-material meant
        // abandoning the form for the Category master.
        return (
          <div key={key}>
            <Label htmlFor="mt-sub-category">Sub Category</Label>
            <CreatableSubCategoryField
              id="mt-sub-category"
              value={form.sub_category_id}
              options={subCategoryOptions}
              onChange={(v) => set({ sub_category_id: v })}
              onCreate={createSubCategoryInline}
              canCreate={perms.canCreate}
            />
          </div>
        );
      case "item_type_name":
        // General only — the third segment of the composed Name (see
        // suggestedName). Free text: the client's consumables aren't a list
        // anyone maintains, they are whatever was bought this month.
        return (
          <div key={key}>
            <Label htmlFor="mt-item-type">
              Item Type
              {req("item_type_name") && <span className="ml-0.5 text-danger">*</span>}
            </Label>
            <Input
              id="mt-item-type"
              uppercase
              placeholder="BRUSH"
              // Mandatory on GENERAL — it is the second segment of the composed
              // Name, so a General material without it cannot be named. The star
              // and the hold both come from this one call, as everywhere else.
              required={req("item_type_name")}
              value={form.item_type_name}
              onChange={(e) => set({ item_type_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
        );
      case "item_base_name":
        return (
          <div key={key}>
            <Label htmlFor="mt-item-name">Item Name</Label>
            <Input
              id="mt-item-name"
              uppercase
              placeholder="NYLON 4 INCH"
              value={form.item_base_name}
              onChange={(e) => set({ item_base_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
        );
      case "specifications":
        return (
          <div key={key}>
            <Label>Description</Label>
            <Input uppercase value={form.specifications} onChange={(e) => set({ specifications: e.target.value })} className="text-base md:text-sm" />
          </div>
        );
      case "short_spec":
        return (
          <div key={key}>
            <Label>Short Spec</Label>
            <Input uppercase value={form.short_spec} onChange={(e) => set({ short_spec: e.target.value })} className="text-base md:text-sm" />
          </div>
        );
      case "count_id":
        return (
          <LookupDialogPicker
            key={key}
            kind="yarn_count"
            label="Count"
            // Mandatory on YARN only, and `req` already knows that — Count is
            // meaningless on a General, which is exactly why requiredness here
            // cannot live in the Zod schema and goes through REQUIRED_BY_FORM.
            required={req("count_id")}
            options={counts}
            value={form.count_id}
            onChange={(v) => set({ count_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
          />
        );
      case "purity_id":
        return (
          <LookupDialogPicker
            key={key}
            kind="yarn_purity"
            label="Purity"
            options={purities}
            value={form.purity_id}
            onChange={(v) => set({ purity_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
          />
        );
      case "shade":
        return (
          <div key={key}>
            <Label>Shade</Label>
            <Input uppercase value={form.shade} onChange={(e) => set({ shade: e.target.value })} className="text-base md:text-sm" />
          </div>
        );
    }
  }

  // Live auto-name generator (0279) — Yarn: Count + Purity + Category (MIXING);
  // Fabric: FABRICTYPE STRUCTURE (COMPONENTS) 100% (client 2026-07-23 #10/#12).
  // Returns null for other classes (General etc.), which stay manual. For
  // Yarn/Fabric it is written straight into the Name field via the effect below.
  const suggestedName = useMemo(() => {
    if (formKey === "YARN") {
      // Name = Count + Purity + Category NAME (user 2026-07-24: order is
      // count, yarn purity, then the category's own name, e.g. "cotton mixed").
      const parts = [
        form.count_id ? countLabel.get(form.count_id) : null,
        form.purity_id ? purityLabel.get(form.purity_id) : null,
        selectedCategory?.name ?? null,
      ].filter(Boolean);
      if (selectedCategory?.made === "Mixed") {
        // Mixing is optional — only rows the user has actually completed (a %
        // plus a component yarn or description) join the name; blank/partial
        // rows never inject "?" placeholders.
        const filled = mixings
          .map((m) => ({
            pct: m.blend_pct,
            label: m.component_item_id ? yarnItemName.get(m.component_item_id) ?? "" : m.description.trim(),
          }))
          .filter((m) => m.pct && m.label);
        // THE MIXING READS AS LEGACY RP DOES (client 2026-08-04, screenshots of
        // both side by side): a parenthetical, each component NAMED FIRST and
        // its share after, comma-separated —
        //   legacy   24'S POLYCOTTON (COTTON 45%, POLYSTER 55%)
        //   ours was 30'S GASED LINEN 050% 16'S OE COTTON / 50% 20'S COTTON COMBED
        // Four things were wrong at once: no parens, the % led instead of
        // trailed, " / " instead of ", ", and the raw input string reached the
        // name so a typed "050" showed as "050%".
        //
        // `mixingParens` is shared with the Fabric branch below, which had the
        // legacy shape from the start (2026-07-23) — the two were composing the
        // same idea two different ways in one file, which is how this drifted
        // unnoticed. One helper, so they cannot disagree again.
        //
        // Deliberately NOT copied from legacy: the component keeps its FULL
        // name. Legacy prints the short fibre ("COTTON") and can, because its
        // two components were different fibres; a blend of 16'S OE COTTON and
        // 20'S COTTON COMBED would collapse to "COTTON 50%, COTTON 50%" and
        // stop identifying anything (client asked, 2026-08-04).
        if (filled.length) parts.push(mixingParens(filled));
      }
      // Generated names come out in CAPS (client 2026-07-23).
      return parts.join(" ").toUpperCase() || null;
    }
    if (formKey === "FABRIC") {
      // Client format (2026-07-23 #10/#12): FABRICTYPE STRUCTURE (COMPONENTS) 100%
      // e.g. "SOLID SINGLE JERSEY (24'S COMBED COTTON 95%, 20'S ELASTANE 5%) 100%".
      // FABRICTYPE = Solid/Yarn Dyed/Melange; STRUCTURE = the picked Structure
      // (category) NAME — not the Circular/Flat/Woven lookup. Only completed
      // mixing rows join the parens (no "?" placeholders): Single Yarn shows
      // one label with no %, Yarn Dyed lists labels only, otherwise each
      // component carries its %. No components yet → just "FABRICTYPE STRUCTURE"
      // (no empty parens, no dangling 100%).
      const head = [
        form.fabric_type_id ? fabricTypeLabel.get(form.fabric_type_id) : null,
        selectedCategory?.name ?? null,
      ]
        .filter(Boolean)
        .join(" ");
      const filled = mixings
        .map((m) => ({
          pct: m.blend_pct,
          label: m.component_item_id ? yarnItemName.get(m.component_item_id) ?? "" : m.description.trim(),
        }))
        .filter((m) => m.label && (isYarnDyedFabric || isSingleYarnFabric || m.pct));
      if (filled.length) {
        // Single Yarn is one label and no share; Yarn Dyed lists labels only.
        // Everything else is the same parenthetical the Yarn branch builds.
        const comps = isSingleYarnFabric
          ? `(${filled[0].label})`
          : isYarnDyedFabric
            ? `(${filled.map((m) => m.label).join(", ")})`
            : mixingParens(filled);
        return `${head}${head ? " " : ""}${comps} 100%`.toUpperCase();
      }
      return head.toUpperCase() || null;
    }
    // General (client 2026-07-28): CATEGORY / SUB CATEGORY / ITEM TYPE / ITEM
    // NAME — e.g. "ELECTRICAL / LIGHTS / BULB / 9W LED". Same shape as the
    // accessory branch below (category first, then what identifies the item),
    // with a fixed " / " separator rather than a configured one — General has no
    // attribute set to carry a name_separator. Blank segments drop out, so a
    // half-filled form composes as far as it can instead of showing "/ / /".
    if (formKey === "GEN") {
      const parts = [
        selectedCategory?.name,
        subCategoryName,
        form.item_type_name.trim(),
        form.item_base_name.trim(),
      ].filter(Boolean);
      return parts.length ? parts.join(" / ").toUpperCase() : null;
    }
    // SEW/PACK attribute-driven (User Defined = No): Category ‹sep› answers —
    // e.g. "LABEL / MAIN / PRINTED / WOVEN / RFID" (client 2026-07-25, no description).
    if (attributeDriven && attrQuestions.length) {
      const answerParts = attrQuestions.map((q) => (answers[q.lineId] ?? "").trim());
      const parts = [selectedCategory?.name, ...answerParts].filter(Boolean);
      return parts.length ? parts.join(attrSeparator).toUpperCase() : null;
    }
    return null;
  }, [formKey, attributeDriven, form.count_id, form.purity_id, form.fabric_type_id, form.item_type_name, form.item_base_name, subCategoryName, selectedCategory, mixings, countLabel, purityLabel, fabricTypeLabel, yarnItemName, attrQuestions, answers, attrSeparator, isYarnDyedFabric, isSingleYarnFabric]);

  /**
   * Does THIS CLASS compose its own Name? A property of the class, deliberately
   * not of `suggestedName`.
   *
   * `suggestedName` is null until the driving fields are filled, so keying the
   * Name field's tab behaviour off it meant the field was a tab stop exactly
   * while the form was blank — which is when the operator is tabbing through
   * it — and then silently left the tab order the moment a Count was picked.
   * One field, two answers to the same key, depending on how far the record was
   * filled in. The class is known from the start, so the answer is stable from
   * the start.
   *
   * Keep this list in step with the branches in `suggestedName` above.
   */
  const nameIsComposed =
    formKey === "YARN" || formKey === "FABRIC" || formKey === "GEN" || attributeDriven;

  // Auto-write the generated name. `suggestedName` covers Yarn, Fabric, General
  // and the attribute-driven accessory classes — it returns null only while the
  // fields it composes from are still empty, never as a "this class is manual"
  // signal. Depends on suggestedName only — the value-compare guards against the
  // effect looping on its own set().
  useEffect(() => {
    if (suggestedName) {
      setForm((f) => (f.name === suggestedName ? f : { ...f, name: suggestedName }));
    }
  }, [suggestedName]);

  // A category quick-created from the Fabric "Structure" picker only lands in
  // this screen's `categories` prop after router.refresh(); by then
  // handleFabricCategoryChange has already run against the stale list and found
  // no structure to derive. Re-derive the structure once the refreshed category
  // resolves — only to FILL an empty structure, never to override a manual pick
  // (a truthy fabric_structure_id short-circuits this). The UOM default then
  // follows from the fabric UOM effect above (fills the blank UOMs from it).
  useEffect(() => {
    if (formKey !== "FABRIC" || !form.category_id || form.fabric_structure_id) return;
    const cat = categories.find((c) => c.id === form.category_id);
    const structureId = cat?.fabric_structure_id;
    if (!structureId) return;
    set({ fabric_structure_id: structureId });
  }, [categories, form.category_id, form.fabric_structure_id, formKey]);

  // Real-time duplicate check on Name, scoped to the selected Item Class.
  // Synchronous against the loaded rows AND debounced against the server, in one
  // hook. The local half sets `data-dup-error` in the SAME render as the typed
  // name (client 2026-07-24), so a fast Enter or Tab is refused instead of
  // slipping past the 300ms debounce; the server half stays the authoritative
  // backstop, since these rows are only the ones held in memory. This used to be
  // a hand-rolled `rows.some(...)` beside the hook — the same union, spelled out
  // once more, with its own copy of the message to keep in step.
  const dupMessage = useDuplicateName({
    table: "items",
    name: form.name ?? "",
    scope: { item_class_id: form.item_class_id || null },
    excludeId: editId ?? undefined,
    enabled: !!(form.name && form.item_class_id),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
    rowInScope: (r) => (r.item_class_id ?? "") === (form.item_class_id ?? ""),
  });
  const nameDuplicate = !!dupMessage;

  /**
   * "Did you mean?" on Name — but ONLY for the classes that let a human type it.
   *
   * `nameIsComposed` covers Yarn, Fabric, General and every attribute-driven
   * accessory: those names are written by the effect above from the fields the
   * operator answered, so a chip there would offer to "correct" the system's own
   * output, and accepting it would put the field out of step with the attributes
   * that produced it until the next keystroke silently overwrote it again. The
   * duplicate ERROR still applies to a composed name (a repeated combination is
   * exactly what doc/itemclass.md §3 says must be blocked) — it is the
   * suggestion, not the check, that has nothing to say here.
   *
   * No curated vocabulary: a material name is site-specific, and a seed offered
   * across item classes is the precise 2026-07-28 failure (a Packing name
   * "corrected" to COTTON). Rows only, and only rows in the same item class, so
   * a Packing material can only ever be offered other Packing materials.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    names: rows
      .filter(
        (r) =>
          r.id !== editId &&
          (r.item_class_id ?? "") === (form.item_class_id ?? ""),
      )
      .map((r) => r.name ?? "")
      .filter(Boolean),
    seed: [],
    enabled: !!form.item_class_id && !nameIsComposed,
    onApply: (v) => set({ name: v }),
  });

  /** Shared blend/mixing grid — Fabric ("Using" Single/Multiple yarn, Decision 4)
   *  and Yarn (only when Category nature = Mixed, Decision 7). Each row links to
   *  a real Yarn `items` record where possible; % must sum to 100 to save.
   *
   *  `variant: "fabric"` renders the "Attributes" table (# | Yarn | Mixing %);
   *  `variant: "yarn"` shows Yarn / Mixing % / Shade (update.md #11).
   *  NO free-text Description in either variant (user 2026-07-23: attribute
   *  rows link a real Yarn record only — quick-create covers missing yarns).
   *  `description`/`uom_id` stay in the row data for legacy rows, just not
   *  editable here. */
  function mixingGrid(variant: "fabric" | "yarn" = "yarn") {
    // Gated on a row carrying DATA, not on a row existing: picking "Using" now
    // seeds row 1 (handleFabricUsingChange), and a bare `mixings.length > 0`
    // would flash a red "0% of 100%" the instant they pick it, before they have
    // done anything wrong. Save is unaffected either way — mixPctSumInvalid
    // already requires a non-null blend_pct.
    const pctBadge = mixings.some((m) => m.component_item_id || numOrNull(m.blend_pct) != null) && (
      <span className={cn("text-xs font-medium", Math.abs(mixPctSum - 100) < 0.01 ? "text-success" : "text-danger")}>
        {mixPctSum}% of 100%
      </span>
    );
    /**
     * PICK ONCE. The same component yarn on two blend lines is not a blend, it
     * is one yarn whose two percentages should have been added together — and it
     * silently breaks the "% must sum to 100" check into a sum nobody can read.
     *
     * A plain array, not a `useMemo`: `mixingGrid` is a helper function, not a
     * component, so a hook here would be called conditionally. `mixings` is a
     * handful of rows.
     */
    const usedComponentIds = mixings.map((m) => m.component_item_id).filter(Boolean);
    const compCell = (m: MixRow) => (
      <ItemPicker
        label=""
        title="Component Yarn"
        items={yarnItems}
        value={m.component_item_id}
        usedIds={usedComponentIds}
        onChange={(v) => setMix(m.key, { component_item_id: v })}
        placeholder="— Component yarn —"
        quickCreateClassId={yarnClassId ?? undefined}
        canCreate={perms.canCreate}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        yarnQuickCreate={{ counts, purities, yarnTypes, categories: yarnCategories, kgUnitId }}
      />
    );

    if (variant === "fabric") {
      // Yarn-dyed: percentages don't apply — just list the component yarns.
      // Single Yarn is implicitly 100%, so it hides the % column too, and caps
      // the grid at one row — once a row exists the "+ Add" button is hidden
      // entirely, so only the single row shows (client 2026-07-24).
      const hidePct = isYarnDyedFabric || isSingleYarnFabric;
      // The "required" hint OUTRANKS the % badge: a row with 100% typed into it
      // but no yarn picked would otherwise show a green "100% of 100%" next to a
      // Save button that refuses to work.
      const requiredHint = fabricCompositionMissing ? (
        <span className="text-xs font-medium text-danger">Required — name at least one yarn</span>
      ) : null;
      return (
        <ChildGrid<MixRow>
          label="Attributes (Mixing)"
          badge={requiredHint ?? (hidePct ? undefined : pctBadge)}
          inlineCards
          frameless
          rows={mixings}
          onAdd={addMix}
          hideAdd={isSingleYarnFabric && mixings.length >= 1}
          onRemove={(m) => delMix(m.key)}
          columns={[
            { header: "Yarn", cell: compCell },
            ...(hidePct
              ? []
              : [
                  {
                    header: "Mixing %",
                    align: "center" as const,
                    width: "5rem",
                    cell: (m: MixRow) => (
                      <Input type="number" step="0.01" placeholder="%" value={m.blend_pct} onChange={(e) => setMixPct(m.key, e.target.value)} className="text-center" />
                    ),
                  },
                ]),
          ]}
        />
      );
    }

    return (
      <ChildGrid<MixRow>
        label="Mixing"
        badge={pctBadge}
        inlineCards
        rows={mixings}
        onAdd={addMix}
        onRemove={(m) => delMix(m.key)}
        addLabel="+ Add mixing row"
        columns={[
          { header: "Yarn", cell: compCell },
          { header: "Mixing %", align: "center", width: "5rem", cell: (m) => <Input type="number" step="0.01" placeholder="%" value={m.blend_pct} onChange={(e) => setMixPct(m.key, e.target.value)} className="text-center" /> },
          { header: "Shade", width: "7rem", cell: (m) => <Input uppercase placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} /> },
        ]}
      />
    );
  }

  /** Fabric Details (0301/0302) — legacy order Structure → Fabric Type
   *  → Direct Purchase → Using → Attributes:
   *  - Structure: the specific knit/weave pattern (e.g. "1X1 FANCY RIB") —
   *    this is `category_id`, scoped to the Fabric item class same as every
   *    other class's Category, just labeled "Structure" here. Picking it also
   *    derives the fabric_structure_id (Circular/Flat/Woven) off the category
   *    row and auto-fills the UOM (0279 #17/#18) — no separate Type picker. */
  function fabricDetails() {
    return (
      <>
        {/* Organized fabric layout (doc/ui/New Material Fabric - Organized
            Layout.html): Classification on the 12-col track, each field sized to
            its data, with the long hints tucked into ⓘ tooltips; Mixing nests
            INSIDE Composition (it IS the composition), never in the right
            column. The section sits in the LEFT column of the two-column split,
            exactly as the mockup draws it, and its fields are `lg` — the
            mockup's Classification is a `.grid2` of `1fr 1fr`, so Structure and
            Type share the first row and Fabric Type takes the second. */}
        <DetailSection label="Classification" cols={12}>
            <Field size="lg">
              <CategoryPicker
                label="Structure"
                // MANDATORY, and it always was — `category_id` has been in
                // FABRIC's `REQUIRED_BY_FORM` set from the start, so Save was
                // already blocked without it. The picker just never carried the
                // prop, so the field drew no `*` and never held: required in the
                // logic, silent in the UI (client 2026-08-04).
                //
                // Requiring THIS is also what makes Type satisfiable. Type is
                // read-only and derived from the picked category's structure, so
                // it can never be required itself — a hold on a field the
                // operator cannot type into is a cage with no keyboard exit. The
                // contract's answer is to require the SOURCE, and Structure is
                // the source; fill it and Type fills itself.
                required={req("category_id")}
                categories={scopedCategories}
                value={form.category_id}
                onChange={handleFabricCategoryChange}
                itemClassId={form.item_class_id}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                fabricStructures={fabricStructures}
              />
            </Field>
            {/* `lg`, because this section sits in a `SectionColumn` (~566px)
                where LAYOUT.md §3's ~280px reference field is 6 of 12. `sm` here
                is ~132px — half the reference, and the commonest layout bug on
                these screens: it showed as Type and Fabric Type starved to
                ~165px with neither "— Pick a Structure —" nor "— Select —"
                fitting (client 2026-08-04).

                The two are coupled and must move together: `sm` is correct only
                across the full sheet (3 of 12 of ~1150px IS the 280px reference).
                Stacking the sections to get three fields on one row was tried and
                reverted the same day — the signed-off mockup is a two-column
                split with two fields per row, and it is the authority. */}
            <Field size="lg">
              {/* Fabric "Type" — Circular Knit/Flat Knit/Woven. Derived from the
                  picked Structure/category (which already carries its structure,
                  set in the Category child) and shown read-only — no separate
                  list to pick from here (user 2026-07-24). */}
              <Label htmlFor="mt-fabric-structure" className="flex items-center gap-1">
                Type
                <span title="Circular Knit, Flat Knit or Woven — comes from the Structure/category and fixes the units: Circular Knit = KGS, Flat Knit = NOS with KGS alternative, Woven = MTR with KGS alternative." className="cursor-help text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </Label>
              {/* `truncate` used to sit on THIS div, which is `flex` — so it
                  clipped the flex ITEM, never the text, and the placeholder
                  "— Pick a Structure —" ran straight out of the box and over
                  Fabric Type beside it (client 2026-08-04). `min-w-0` is the
                  other half: a flex child will not shrink below its content
                  width without it, so even a correct `truncate` inside would
                  have had nothing to shrink into.

                  `Truncated` rather than a bare `truncate` span, per the standing
                  rule — an ellipsis is a promise the rest is reachable, and this
                  is a real value (a structure name) that can genuinely be cut. */}
              <div
                id="mt-fabric-structure"
                className="flex h-9 min-w-0 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground"
              >
                <Truncated
                  text={
                    fabricStructures.find((s) => s.id === form.fabric_structure_id)?.name ??
                    "— Pick a Structure —"
                  }
                  className="min-w-0"
                />
              </div>
            </Field>
            {/* `lg`, same reason as Type above — and it takes the second row on
                its own, which is exactly what the mockup's `.grid2` draws. */}
            <Field size="lg">
              {/* Fixed 3-value classification (Solid/Yarn Dyed/Melange) — plain
                  dropdown, no Add/Modify/Delete (client 2026-07-23, Screenshot
                  2070): users must pick, never grow this list.

                  Deliberately NOT converted to a picker in the 2026-07-31 sweep
                  that gave Count / Purity / Category theirs, and the reason is
                  structural rather than a preference: code branches on this
                  value's NAME — `.includes("yarn") && .includes("dyed")` (:637)
                  and `=== "melange"` (:468, :1335) gate the Shade field and the
                  Mixing grid's rules. A type added here would do nothing, and a
                  type RENAMED here would silently break both. Widen this list
                  only alongside the branches that read it. */}
              <Label htmlFor="mt-fabric-type" className="flex items-center gap-1">
                Fabric Type <span className="text-danger">*</span>
                <span title="Solid, Yarn Dyed or Melange — determines the dyeing PO type." className="cursor-help text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </Label>
              <Select
                id="mt-fabric-type"
                // The `*` above was hand-drawn and nothing backed it: the field
                // was in FABRIC's required set and blocked Save, but the control
                // never held, so the operator saw a mandatory marker and Tab
                // walked straight past it. Same declaration, same source.
                required={req("fabric_type_id")}
                value={form.fabric_type_id}
                onChange={(e) => handleFabricTypeChange(e.target.value)}
              >
                <option value="">— Select —</option>
                {fabricTypes
                  .filter((t) => t.is_active || t.id === form.fabric_type_id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {/* Melange fabric carries its shade (client 2026-07-23) */}
            {fabricTypeLabel.get(form.fabric_type_id)?.toLowerCase() === "melange" && (
              <Field label="Shade" size="sm" htmlFor="mt-fabric-shade">
                <Input
                  uppercase
                  id="mt-fabric-shade"
                  value={form.shade}
                  onChange={(e) => set({ shade: e.target.value })}
                />
              </Field>
            )}
        </DetailSection>
        <DetailSection label="Composition" cols={12}>
            {/* Using comes FIRST, and Direct Purchase is off the Tab path while it is
                unticked (client 2026-08-01). Ticking it wipes the mixing rows, and Enter
                TICKS a checkbox rather than moving past it — so on the default typing
                path the operator was one habitual Enter away from silently discarding a
                typed composition. Reach it with ↓ / → or the mouse. Once ticked it
                rejoins the path, because it is then the only way back. */}
            {!form.direct_purchase && (
              <Field label="Using" size="sm">
                <Select value={form.fabric_using} onChange={(e) => handleFabricUsingChange(e.target.value)}>
                  <option value="">— None —</option>
                  {FABRIC_USING.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field size="sm">
              <label className="flex h-9 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  data-focus-optional={form.direct_purchase ? undefined : ""}
                  checked={form.direct_purchase}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    set({ direct_purchase: checked });
                    if (checked) setMixings([]);
                  }}
                />
                <span className="text-sm text-foreground">Direct Purchase</span>
              </label>
            </Field>
            {fabricAttributesVisible && (
              <div className="space-y-2 @lg/section:col-span-12">
                <div className="h-px bg-border" />
                {mixingGrid("fabric")}
              </div>
            )}
        </DetailSection>
      </>
    );
  }

  /** Yarn Details (0279) — Mixing shows for a Mixed-nature Category OR for an
   *  inherently-blended Yarn Type. FINAL rule (user, 2026-07-24 — reinstates the
   *  yarn-type gate that 2026-07-23 had dropped in favour of Mixed-nature-alone):
   *  Mixing visible when categories.made = "Mixed" OR Yarn Type ∈
   *  {Twisted, Doubling, Melange}. So a Grey poly-cotton blend still shows via a
   *  Mixed category, and a Doubling/Twisted/Melange yarn shows via its type even
   *  with no category picked. See `yarnMixingVisible` at the render root. */
  function yarnDetails() {
    const nature = selectedCategory?.made ?? null;
    const ytName = yarnTypes.find((y) => y.id === form.yarn_type_id)?.name?.toLowerCase() ?? null;
    return (
      <>
        {/* Yarn Type and its optional Shade are both single words — they share
            one row instead of taking a stacked column each (client 2026-07-24
            #3). */}
        <DetailSection label="Yarn Type" cols={12}>
            <Field size="md">
              <LookupDialogPicker
                kind="yarn_type"
                label="Yarn Type"
                required={req("yarn_type_id")}
                options={yarnTypes}
                value={form.yarn_type_id}
                onChange={handleYarnTypeChange}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </Field>
            {/* Melange yarn carries its shade (client 2026-07-23) */}
            {ytName === "melange" && (
              <Field label="Shade" size="sm" htmlFor="mt-yarn-shade">
                <Input
                  uppercase
                  id="mt-yarn-shade"
                  value={form.shade}
                  onChange={(e) => set({ shade: e.target.value })}
                />
              </Field>
            )}
        </DetailSection>
        {/* Count ("40'S/2"), Nature and Purity are all short values; only
            Category carries a long name. Four fields now fit one row. */}
        <DetailSection label="Classification" cols={12}>
            <Field size="sm">
              {/* Was a plain dropdown with no Add/Modify/Delete (client
                  2026-07-23 #4, "counts are a fixed list that never grows
                  here") — REVERSED by the client on 2026-07-31: an operator hit
                  a count the list didn't carry and had nowhere to add it. It is
                  now the same shape as Category and Purity beside it, which is
                  the inconsistency that was reported. */}
              <LookupDialogPicker
                kind="yarn_count"
                label="Count"
                required={req("count_id")}
                options={counts}
                value={form.count_id}
                onChange={(v) => set({ count_id: v })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </Field>
            <Field size="md">
              <CategoryPicker
                label="Category"
                required={req("category_id")}
                categories={scopedCategories}
                value={form.category_id}
                onChange={(v) => set({ category_id: v })}
                itemClassId={form.item_class_id}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                fabricStructures={fabricStructures}
              />
            </Field>
            {nature && (
              <Field label="Nature" size="xs">
                <div className="flex h-9 items-center truncate rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground">{nature}</div>
              </Field>
            )}
            <Field size="sm">
              <LookupDialogPicker
                kind="yarn_purity"
                label="Purity"
                options={purities}
                value={form.purity_id}
                onChange={(v) => set({ purity_id: v })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </Field>
        </DetailSection>
        {/* Mixing grid renders full-width below the two-column body — see
            yarnMixingVisible at the render root (Screenshot 2079). */}
      </>
    );
  }

  /* "Using (Items)" (0304) was a General-only grid listing which other items a
     material uses. Dropped from the form — General doesn't have that concept
     (client 2026-07-28). Per the minimal-forms rule the DB side is untouched:
     `material_using_items` still exists and `usingItems` still round-trips
     through load and save, so any legacy rows survive an edit rather than being
     silently deleted. Re-rendering it is a one-line change if that reverses. */

  /* The list used to carry HSN Code plus all five UOM slots (Base / Stock /
     Billing / Planning / Purchase). Nobody reads them there: four of the five
     are the same unit on ~90% of materials, and HSN belongs to the tax paperwork,
     not to finding a material (client 2026-07-28 #8). All six are gone; the eye
     icon opens the full record instead. HSN is still SEARCHABLE (see the search
     predicate above) — it just doesn't own a column. */
  const columns: Column<Material>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Category Name",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.category_id ? catLabel.get(r.category_id) ?? "—" : "—"}</span>,
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>,
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onView={() => setViewRow(r)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
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
          searchPlaceholder="Search materials…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="material-filter-status">Status</Label>
            <Select
              id="material-filter-status"
              value={filterValues.status}
              onChange={(e) => {
                setFilter("status", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="material-filter-class">Item Class</Label>
            <Select
              id="material-filter-class"
              value={filterValues.itemClass}
              onChange={(e) => {
                setFilter("itemClass", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {itemClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="material-filter-type">Material Type</Label>
            <Select
              id="material-filter-type"
              value={filterValues.materialType}
              onChange={(e) => {
                setFilter("materialType", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {MATERIAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="material-filter-category">Category</Label>
            <Select
              id="material-filter-category"
              value={filterValues.category}
              onChange={(e) => {
                setFilter("category", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {catLabel.get(c.id) ?? "—"}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="materials" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Material
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, rows)} rows={pg.paged} getKey={(r) => r.id} empty="No materials yet." />
      </div>

      {/* mobile cards — the shared list, so the eye (view) and delete
          affordances the desktop table has are on the phone too. Was a
          hand-rolled tap-to-edit card, which had no room for either. */}
      <div className="md:hidden">
        <MobileCardList<Material>
          rows={pg.paged}
          getKey={(r) => r.id}
          title={(r) => r.name}
          meta={(r) => (r.item_class_id ? classLabel.get(r.item_class_id) ?? null : null)}
          pill={(r) => <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>}
          onView={(r) => setViewRow(r)}
          onEdit={perms.canEdit ? openEdit : undefined}
          canDelete={perms.canDelete}
          onDelete={remove}
          isPending={isPending}
          empty="No materials yet."
        />
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor — full-screen for room (doc/update.md #10) */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        fullScreen
        title={editId ? `Edit Material — ${editName}` : "New Material"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={
                isPending ||
                !form.name.trim() ||
                // ONE list of mandatory fields, shared with the `*`s beside them,
                // with the cursor hold that stops the operator leaving one blank,
                // and with the action that also serves spreadsheet imports. This
                // used to be a hand-written expression here — two lists on one
                // screen is exactly how the button and the fields drift apart.
                missingRequired.length > 0 ||
                singleYarnOverflow ||
                mixPctSumInvalid ||
                fabricCompositionMissing ||
                attrMandatoryMissing ||
                attributeSetMissing ||
                nameDuplicate
              }
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Identity row — Item Class | Name | HSN, per the planned layout
              (doc/ui/New Material - Planned Layout.html, 2026-07-23). The Name
              moved up from the foot of Details; its auto-generation for
              Yarn/Fabric is unchanged. */}
          {/* Item Class is a picked name, Name is the long free text, HSN is 8
              digits — the tracks are weighted to match, so HSN stops occupying
              a quarter of the row (client 2026-07-24 #3). */}
          <IdentityRow tracks="minmax(0,0.8fr) minmax(0,2fr) 10rem">
            <div>
              {/* Also deliberately left a plain dropdown by the 2026-07-31
                  picker sweep: `itemClassForm(selectedClassCode)` (:233-234)
                  selects this whole form from the class's CODE, so a class
                  added from here would open a form that does not exist. Item
                  Class is maintained from its own master, where the code and
                  its form are decided together. */}
              {/* A `Field` rather than a bare Label + Select so the `*` and the
                  mandatory-field cursor hold come from ONE declaration. Its
                  column spans only resolve inside `@container/section`, and this
                  sits in `@container/identity`, so the IdentityRow tracks above
                  still decide the width. */}
              <Field label="Item Class" required={req("item_class_id")} htmlFor="mt-item-class">
              <Select
                id="mt-item-class"
                value={form.item_class_id}
                onChange={(e) => handleItemClassChange(e.target.value)}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {itemClasses
                  .filter((c) => c.is_active || c.id === form.item_class_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
              </Field>
            </div>
            <div>
              <Label htmlFor="mt-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="mt-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                // A composed Name is never a tab stop — the operator reaches it
                // by CLICK when they want to override one, which is the rare
                // case. Keyed off the class, not off whether a name has been
                // composed yet: see `nameIsComposed`.
                //
                // `readOnly` is narrower on purpose. Attribute-driven
                // accessories and General cannot be named by hand at all (the
                // fields ARE the name — client 2026-07-28), while Yarn and
                // Fabric compose a name that the operator may still overwrite.
                // Both are out of the Tab order either way.
                tabIndex={nameIsComposed ? -1 : undefined}
                readOnly={attributeDriven || formKey === "GEN"}
                className={cn(
                  "text-base md:text-sm",
                  nameDuplicate && "border-danger",
                  (attributeDriven || formKey === "GEN") && "bg-surface-muted",
                )}
                // Emitted even when the field is readOnly above. The HOLD is
                // what has to stand down on a field the operator cannot type
                // into — and it does, in keyboard-nav-provider.tsx, once for
                // every screen. Suppressing the marker here instead would also
                // take away the red border and the announcement, which a
                // composed duplicate name still needs.
                {...dupFieldProps(dupMessage, "mt-name")}
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                // The hook stands itself down on the composed classes, so this
                // is inert exactly where the field is read-only.
                onKeyDown={nameSuggest.onKeyDown}
              />
              <DuplicateError error={dupMessage} id="mt-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupMessage}
                onApply={(v) => set({ name: v })}
              />
            </div>
            <LookupDialogPicker
              kind="hsn_code"
              label="HSN Code"
              options={hsnCodes}
              value={form.hsn_id}
              onChange={(v) => set({ hsn_id: v })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
          </IdentityRow>

          {/* Everything below the identity row waits for an Item Class — an
              empty details column beside a full UOM card reads as a broken
              form (Screenshot 2078). */}
          {!form.item_class_id ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-12 text-center text-sm text-muted-foreground">
              Select an Item Class above to see its detail fields.
            </div>
          ) : (
            <>
          {/* Two-column body — class-specific details LEFT, UOM RIGHT. No more
              Details/UOM tabs: both are always visible (planned layout), so the
              duplicate-name error simply gates Save.

              EXCEPT ON FABRIC, where both columns claim the full row and the
              sections simply stack (client 2026-08-04). Fabric's Classification
              holds three fields — Structure, Type, Fabric Type — and only two fit
              a half-width column: LAYOUT.md §3 fixes the field at ~280px, which
              in a `SectionColumn` is `lg`, 6 of 12. Shrinking them inside the
              column is not the way out and was tried and reverted the same day
              (see the note on Structure in `fabricDetails`). §3's own answer is
              to stack: across the sheet the reference width is `sm`, 3 of 12, and
              four fit — so three sit on one row at full size rather than a
              squeezed one. `applicant`, `bank`, `courier-delivery` and `notify`
              already do this.

              The LEFT/RIGHT rule below still governs the other classes; on
              Fabric the same order simply reads top-to-bottom instead. */}
          <SectionGrid>
            <SectionColumn>
              {formKey === "FABRIC" ? (
                fabricDetails()
              ) : formKey === "YARN" ? (
                yarnDetails()
              ) : (
                // Generic classes (General/SEW/PACK/CAP/Garments) share the
                // same dense 2-col layout as Yarn/Fabric — global form rule.
                // Sub Category is in form A's field list but only belongs on
                // screen for a General category that defines one, so it is
                // filtered here rather than splitting the registry in two.
                <DetailSection label="Classification" cols={12}>
                  {formDef?.fields
                    .filter((k) => k !== "sub_category_id" || subCategoryVisible)
                    .map((k) => detailField(k))}
                </DetailSection>
              )}
              {/* 12-col track: a numeric answer is a 2-4 character box, an
                  option list needs room for its longest option. Sizing each to
                  its data fits 3-4 attributes per row instead of 2 wide,
                  half-empty ones (client 2026-07-24 #3). */}
              {attributeSetMissing && (
                <div className="rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                  No Material Attributes configured for this category yet. Set them up under
                  Materials ▸ Material Attributes, then the questions appear here.
                </div>
              )}
              {/* Legacy grid (Screenshot 132339): one row per configured
                  attribute — # · Attribute · Value picker — replacing the old
                  "Using Items" section for accessories. A Value-In-Steps line
                  picks from its generated steps, a value-list line from its own
                  values, anything else a free number box. */}
              {attrQuestions.length > 0 && (
                <DetailSection label="Attributes">
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-muted">
                          <th className="w-10 px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">#</th>
                          <th className="px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground">Attribute</th>
                          <th className="border-l border-border px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attrQuestions.map((q, i) => {
                          // The line's stored value list is the source (stepped
                          // values are generated + saved on the config screen,
                          // blocked ones already excluded). Fall back to on-the-fly
                          // generation only for legacy stepped configs saved before
                          // options were stored.
                          const fallback =
                            q.valueInSteps && q.options.length === 0
                              ? stepValues(q.start, q.end, q.step).map((v) =>
                                  q.unitLabel ? `${v} ${q.unitLabel}` : String(v),
                                )
                              : [];
                          const choices = q.options.length ? q.options : fallback;
                          const asDropdown = choices.length > 0;
                          return (
                            <tr key={q.lineId} className="border-b border-border last:border-0">
                              <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{i + 1}</td>
                              <td className="px-2 py-1.5">
                                {q.label}
                                {q.mandatory && <span className="text-danger"> *</span>}
                              </td>
                              <td className="border-l border-border px-2 py-1.5">
                                {asDropdown ? (
                                  <Select
                                    value={answers[q.lineId] ?? ""}
                                    onChange={(e) => setAnswers((a) => ({ ...a, [q.lineId]: e.target.value }))}
                                    className="text-base md:text-sm"
                                  >
                                    <option value="">— Select —</option>
                                    {choices.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </Select>
                                ) : (
                                  <Input
                                    type="number"
                                    value={answers[q.lineId] ?? ""}
                                    onChange={(e) => setAnswers((a) => ({ ...a, [q.lineId]: e.target.value }))}
                                    min={q.start ?? undefined}
                                    max={q.end ?? undefined}
                                    step={q.step ?? undefined}
                                    className="text-base md:text-sm"
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </DetailSection>
              )}
              {/* Composition grids belong with the class fields, never with the
                  measurements — global rule (Screenshot 2084): LEFT = what the
                  material is, RIGHT = how it's measured. Every class uses the two
                  columns, so that is literally left and right, and the signed-off
                  fabric mockup draws the same split. What must not change is the
                  GROUPING.
                  Fabric's grid nests in Composition above; Yarn Mixing and Using
                  (Items) render here. */}
              {yarnMixingVisible && mixingGrid("yarn")}
              {/* Using (Items) is a General-item concept only. Accessories
                  (SEW/PACK) list their configured attributes instead (client
                  2026-07-25). */}
            </SectionColumn>

            {/* RIGHT: pure measurement for ALL classes — Units of Measure,
                Conversions, status. Composition grids never render here. On a
                stacked Fabric this is the last full-width band rather than a
                right-hand column; the reading order is unchanged. */}
            <SectionColumn>
              {/* Order follows how the client describes the job (2026-07-28):
                  tick Alternative UOM → the conversion grid comes to the TOP of
                  the section → enter the alternate ↔ base row → then fill the
                  five UOM slots underneath, choosing only from the units that
                  row just named.
                  Those five were briefly removed altogether earlier the same day.
                  That went too far: the complaint was their ORDER and their
                  option list, not their existence — four dropdowns over the whole
                  UOM master, asked before the one row that gives them meaning.
                  Restored below the conversion and filtered to `uomLimit`. */}
              <DetailSection label="Units of Measure" cols={12}>
                {/* Row 1: Base + the toggle, side by side (client 2026-07-28).
                    ~90% of materials are consumed and purchased in the same unit
                    (a label is Numbers everywhere), so everything the toggle
                    reveals stays out of the way until the material says it needs
                    it. Thread (metres → cones) and buttons (numbers → gross) are
                    the cases that tick it.
                    2 + 4 = 6 of 12, so neither cell is cramped — and Base at `xs`
                    sits in track 1, directly above Stock at `xs` in track 1 of
                    the slot row below, so the two rows align by construction
                    rather than by luck.

                    On a `singleUomClass` Base is the ONLY thing in this section,
                    so it takes the standard `sm` width instead: `xs` exists to
                    line up with a slot row those classes no longer have, and a
                    lone 2-of-12 box is just a stranded tiny field. */}
                {/* ONE Base field for every class, editable everywhere (client
                    2026-08-04). Fabric had a read-only `bg-surface-muted` box
                    here for three days, because 2026-08-01 made its unit derived
                    rather than defaulted. "Default" is the word the request came
                    back with, and a default is something you can change — so the
                    structure now PREFILLS this (see the effect above) and the
                    operator has the last word. The ⓘ stays: a field that fills
                    itself still has to say who filled it. */}
                <Field
                  label={
                    formKey === "FABRIC" ? (
                      // `inline-flex`, NOT `flex`. A block-level label box pushes
                      // `Field`'s required `*` onto its own line, so Base showed
                      // the marker stranded under the caption and its control sat
                      // a line lower than every field beside it (client
                      // 2026-08-04). Fabric Type reads correctly because its `*`
                      // is INSIDE the flex row rather than after it.
                      <span className="inline-flex items-center gap-1">
                        Base
                        <span
                          title="Prefilled from the fabric structure — Circular Knit KGS, Flat Knit NOS, Woven MTR. Change it if this material is stocked differently."
                          className="cursor-help text-muted-foreground"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    ) : (
                      "Base"
                    )
                  }
                  required={req("base_uom_id")}
                  size={singleUomClass ? "sm" : "xs"}
                >
                  {uomSelect(form.base_uom_id, (v) => set({ base_uom_id: v }), uomLimit)}
                </Field>
                {/* The `&nbsp;` is a spacer, not decoration: `Field` renders its
                    <Label> only when `label != null`, so an unlabelled cell
                    starts a label's height higher than the labelled Base beside
                    it. `h-9 @2xl/editor:h-8` tracks the Combobox's own height —
                    hard-coding h-9 left the checkbox 4px taller than the select
                    on the wide editor surface.
                    Not offered on Yarn or Fabric — `singleUomClass` covers both. */}
                {!singleUomClass && (
                  <Field label={<>&nbsp;</>} size="md">
                    <label className="flex h-9 @2xl/editor:h-8 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.has_alternate_uom}
                        onChange={(e) => toggleAltUom(e.target.checked)}
                      />
                      <span className="text-sm text-foreground">Alternative UOM</span>
                    </label>
                  </Field>
                )}
                {/* THE UNIT ON SCREEN DISAGREES WITH THE ONE THE STORED
                    QUANTITIES WERE ENTERED IN. Say so — a number does not change
                    meaning quietly just because the label above it did.
                    It began as a fabric-only notice (an existing Flat Knit was
                    stocked in KGS when the structure rule moved it to NOS), and
                    is now for any class and any cause: the structure prefill on a
                    re-picked structure, or the operator changing Base by hand,
                    which is newly possible on fabric. */}
                {fabricUomChanged && (
                  <Field size="full">
                    <p className="text-xs text-warning">
                      Base UOM changes from {unitCode(fabricUomChanged)} to {unitCode(form.base_uom_id)} on save.
                      Quantities already recorded against this material were entered in {unitCode(fabricUomChanged)}.
                    </p>
                  </Field>
                )}
                {/* Conversions as one inline row per record — the legacy wide
                    table doesn't fit a half-width column, and the previous
                    2-col card wrapped four controls onto two lines. Quantities
                    are numeric so they get a fixed narrow track; the UOM pickers
                    share the remaining space. Spans the whole 12-col track: it
                    is a table, not a field.

                    Never on a `singleUomClass`. Fabric used to reach this grid
                    with its units fixed and only the quantities editable (a
                    per-piece weight, "1 pc = 0.42 KGS"); that whole branch went
                    with the alternate UOM UI on 2026-08-01, so what is left here
                    is the plain add/remove grid the other classes always had.
                    The row itself is still DERIVED and still saved — see the
                    fabric effect above — it just cannot be edited from here. */}
                {form.has_alternate_uom && !singleUomClass && (
                  <Field size="full">
                    <ChildGrid<ConvRow>
                      label="Alternate ↔ Base Conversions"
                      rows={conversions}
                      onAdd={addConv}
                      onRemove={(c) => delConv(c.key)}
                      addLabel="+ Add conversion"
                      inlineCards
                      frameless
                      columns={[
                        {
                          header: "Alt qty",
                          align: "center",
                          width: "4.5rem",
                          cell: (c) => <Input type="number" step="0.0001" placeholder="Qty" value={c.alt_qty} onChange={(e) => setConv(c.key, { alt_qty: e.target.value })} className="text-center" />,
                        },
                        // ONE conversion per alternate unit — a second row for
                        // the same Alt UOM is two answers to "how many of these
                        // make a base unit". Deliberately NOT applied to Base
                        // UOM below: every row converts TO the base unit, so
                        // that column repeating is the normal shape.
                        {
                          header: "Alt UOM",
                          cell: (c) =>
                            uomSelect(c.alt_uom_id, (v) => setConv(c.key, { alt_uom_id: v }), undefined, conversions.map((x) => x.alt_uom_id).filter(Boolean)),
                        },
                        {
                          header: "Base qty",
                          align: "center",
                          width: "4.5rem",
                          cell: (c) => <Input type="number" step="0.0001" placeholder="Qty" value={c.base_qty} onChange={(e) => setConv(c.key, { base_qty: e.target.value })} className="text-center" />,
                        },
                        {
                          header: "Base UOM",
                          cell: (c) => uomSelect(c.base_uom_id, (v) => setConv(c.key, { base_uom_id: v })),
                        },
                      ]}
                    />
                  </Field>
                )}
                {/* The four downstream slots, one row of `xs` (2 of 12 each = 8).
                    They appear only with Alternative UOM on: with it off they are
                    all the base unit by definition, and the server writes them
                    that way (material-actions.ts `uomSlots`).
                    "Uom" is dropped from every label — the section is already
                    titled Units of Measure, and "Planning Uom" wraps in a ~85px
                    track while "Planning" does not. Base is NOT here; it sits up
                    on row 1 beside the toggle, in this same track 1.

                    Never on a `singleUomClass`: all four are the base unit, and
                    for fabric the server writes them that way regardless
                    (`applyFabricUomRule`). Showing four dropdowns that the next
                    save overwrites would be a lie about what the operator
                    controls. */}
                {form.has_alternate_uom && !singleUomClass && (
                  <>
                    <Field label="Stock" size="xs">
                      {uomSelect(form.stock_uom_id, (v) => set({ stock_uom_id: v }), uomLimit)}
                    </Field>
                    <Field label="Billing" size="xs">
                      {uomSelect(form.billing_uom_id, (v) => set({ billing_uom_id: v }), uomLimit)}
                    </Field>
                    <Field label="Planning" size="xs">
                      {uomSelect(form.planning_uom_id, (v) => set({ planning_uom_id: v }), uomLimit)}
                    </Field>
                    <Field label="Purchase" size="xs">
                      {uomSelect(form.purchase_uom_id, (v) => set({ purchase_uom_id: v }), uomLimit)}
                    </Field>
                    {/* Says which question to answer first, rather than leaving
                        the dropdowns on the full UOM master with no explanation
                        of why they narrow later. */}
                    {convUnitIds.size === 0 && (
                      <Field size="full">
                        <p className="text-xs text-muted-foreground">
                          Fill a conversion row above — Base and these four then offer only the units it names.
                        </p>
                      </Field>
                    )}
                  </>
                )}
              </DetailSection>

              {/* Budget + Cost Rate removed from the data path (client walkthrough,
                  0279) — no longer edited or written from this screen. The DB
                  columns remain, so any existing values are left untouched. */}

              {editId && (
                <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-3">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => set({ inactive: e.target.checked })} />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              )}
            </SectionColumn>
          </SectionGrid>
            </>
          )}
        </div>
      </Sheet>

      {/* Read-only view — same record, nothing editable, and no way through to
          the editor: Close is the only exit (client 2026-07-30). */}
      <MaterialViewSheet
        open={!!viewRow}
        material={viewRow}
        onClose={() => setViewRow(null)}
        itemClasses={itemClasses}
        categories={categories}
        units={units}
        counts={counts}
        purities={purities}
        fabricTypes={fabricTypes}
        fabricStructures={fabricStructures}
        yarnTypes={yarnTypes}
        materials={rows}
        materialAttributes={materialAttributes}
        attributes={attributes}
      />
    </div>
  );
}

/**
 * Sub Category: type-or-pick, with a "+ Add" row that creates whatever is being
 * typed (client 2026-07-28 #10/#15). Optional — "— None —" is the first row.
 *
 * Deliberately local rather than a `creatable` mode on components/ui/combobox.tsx:
 * that component is what EVERY desktop `<Select>` in the app renders as
 * (select.tsx upgrades to it on a fine pointer), so a new branch there would put
 * ~every dropdown in the ERP at risk for the sake of one field. Local control,
 * shared contract — `role="combobox"` + `aria-expanded` is what lib/focus.ts
 * reads to decide whether ↑/↓ belong to the field or to the surface
 * (`ownsArrowKeys`), so browsing, picking and Esc behave here exactly as they do
 * on a Combobox without touching the shared file. (`data-field-trigger` is the
 * BUTTON half of that contract and is deliberately absent: on an input it would
 * make `arrowOpensPicker` re-click the field on ↓, fighting this component's own
 * handler.)
 *
 * The list is portaled with fixed positioning, like Combobox, because this field
 * sits low in a full-screen Sheet whose body is the one scroll container.
 */
function CreatableSubCategoryField({
  id,
  value,
  options,
  onChange,
  onCreate,
  canCreate,
}: {
  id: string;
  value: string;
  options: CategorySubCategory[];
  onChange: (v: string) => void;
  /** Returns the new id, or null when the create failed (the caller toasts). */
  onCreate: (name: string) => Promise<string | null>;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [creating, setCreating] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const typed = query.trim().toUpperCase();
  const matches = options.filter((o) => !typed || o.name.toUpperCase().includes(typed));
  // Only offer to create what does not already exist — an exact (case- and
  // space-insensitive) hit is the same value the DB's unique index would reject.
  const exact = options.some((o) => o.name.trim().toUpperCase() === typed);
  type Row = { kind: "none" } | { kind: "option"; sc: CategorySubCategory } | { kind: "create" };
  const rows: Row[] = [
    { kind: "none" },
    ...matches.map((sc) => ({ kind: "option", sc }) as Row),
    ...(canCreate && typed && !exact ? [{ kind: "create" } as Row] : []),
  ];

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);
  useEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);
  // Close on a click outside the input or the portaled list.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function openList() {
    setQuery("");
    setHighlight(Math.max(0, options.findIndex((o) => o.id === value) + 1));
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setQuery("");
  }
  // No blur() on commit — dropping focus to <body> is what sends the next Tab
  // back to the top of the Sheet (see the same note in components/ui/combobox.tsx).
  async function commit(row: Row | undefined) {
    if (!row || creating) return;
    if (row.kind === "none") {
      onChange("");
      close();
      return;
    }
    if (row.kind === "option") {
      onChange(row.sc.id);
      close();
      return;
    }
    setCreating(true);
    const created = await onCreate(typed);
    setCreating(false);
    if (created) {
      onChange(created);
      close();
    }
    // Failed create: the list stays open with the typed value intact, so the
    // toast's reason (duplicate name, forbidden) can be acted on.
  }

  /** The same contract as components/ui/combobox.tsx — see the skill
   *  `raagam-keyboard-contract`. ↓ opens / moves down, ↑ moves up but bubbles
   *  when the list is closed (so it means "the field above" and a dropdown is
   *  never a one-way door), Enter picks the highlight and otherwise bubbles to
   *  move to the next field, Tab closes without choosing and lets focus move on,
   *  Esc closes the list only. */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        if (e.key === "ArrowUp") return; // bubbles: "the field above"
        e.preventDefault();
        e.stopPropagation();
        return openList();
      }
      // Consumed here; without stopPropagation the arrow would also drive the
      // surrounding surface's field navigation.
      e.preventDefault();
      e.stopPropagation();
      setHighlight((h) => (e.key === "ArrowDown" ? Math.min(h + 1, rows.length - 1) : Math.max(h - 1, 0)));
    } else if (e.key === "Enter") {
      if (open) {
        // Picking is what this Enter does; without preventDefault it would also
        // reach `enterAdvances` and move off the field it just filled in.
        e.preventDefault();
        e.stopPropagation();
        void commit(rows[highlight]);
      }
    } else if (e.key === "Tab") {
      // Close WITHOUT committing — "Tab never changes a value" — and never
      // preventDefault, or focus would stay put: the move belongs to Sheet's
      // focus trap.
      if (open) close();
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        ref={inputRef}
        uppercase
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={selected ? selected.name : "Type or pick…"}
        value={open ? query : selected?.name ?? ""}
        // No open-on-focus, matching every other dropdown on the form
        // (select.tsx passes openOnFocus={false}): focus alone leaves the list
        // closed, so Enter there still moves to the next field. The list drops
        // on click, on ↓, or as soon as the operator types.
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={cn("pr-8 text-base md:text-sm", !selected && !open && "text-muted-foreground")}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        <ChevronDown className="h-4 w-4 shrink-0" />
      </span>
      {open &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 150 }}
            className="max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
          >
            {rows.map((row, i) => {
              const key = row.kind === "option" ? row.sc.id : row.kind;
              const label =
                row.kind === "none" ? (
                  <span className="text-muted-foreground">— None —</span>
                ) : row.kind === "option" ? (
                  row.sc.name
                ) : (
                  <span className="flex items-center gap-1.5 text-primary">
                    <Plus className="h-4 w-4 shrink-0" />
                    {creating ? `Adding "${typed}"…` : `Add "${typed}"`}
                  </span>
                );
              return (
                <li
                  key={key}
                  role="option"
                  aria-selected={row.kind === "option" && row.sc.id === value}
                  // Focus stays in the input, so use mousedown to beat the blur.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void commit(row);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm",
                    i === highlight ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-surface-muted",
                  )}
                >
                  {label}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
