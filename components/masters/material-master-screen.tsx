"use client";

import { fmtDate } from "@/lib/format";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, type FieldSize } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { createMaterial, updateMaterial, deleteMaterial } from "@/lib/masters/material-actions";
import { createSubCategory } from "@/lib/masters/category-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
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
  FABRIC_STRUCTURE_UOM,
  itemClassForm,
  isAccessoryClass,
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
import type { Commodity } from "@/lib/masters/commodity-types";
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
  commodities,
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
  commodities: Commodity[];
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
  // Yarn-kg default and fabric-structure UOM hints must not miss on case.
  // Active units win a code collision, and kg/kgs are treated as synonyms both
  // pointing at whichever kilogram unit is ACTIVE — so a deactivated "kg" never
  // gets auto-derived (fabric hints) once the shop switches to "KGS".
  const unitIdByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) {
      const key = u.code.toLowerCase();
      if (u.is_active || !m.has(key)) m.set(key, u.id);
    }
    const kgId = units.find((u) => u.is_active && ["kg", "kgs"].includes(u.code.toLowerCase()))?.id;
    if (kgId) {
      m.set("kg", kgId);
      m.set("kgs", kgId);
    }
    return m;
  }, [units]);
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

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
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
  const formDef = formKey === "A" || formKey === "GEN" || formKey === "C" ? MATERIAL_FORMS[formKey] : null;
  const selectedCategory = categories.find((c) => c.id === form.category_id) ?? null;
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

  // Fabric mirrors the Yarn default, but the unit depends on the Structure/Type
  // (Circular/Flat = KGS, Woven = MTR, 2026-07-24). Backfill every empty UOM to
  // that unit — covering a fresh Add AND opening a legacy fabric with blank
  // UOMs — while any non-empty field (a manual override) survives. Switching the
  // Type re-applies the default via handleFabricCategoryChange (which overwrites);
  // this effect only fills blanks, so the two never fight.
  useEffect(() => {
    if (formKey !== "FABRIC") return;
    const code = form.fabric_structure_id ? structureCodeById.get(form.fabric_structure_id) ?? null : null;
    const baseId = structureUomHint(code).baseId;
    if (!baseId) return;
    setForm((f) => {
      const patch: Partial<Form> = {};
      if (!f.base_uom_id) patch.base_uom_id = baseId;
      if (!f.stock_uom_id) patch.stock_uom_id = baseId;
      if (!f.billing_uom_id) patch.billing_uom_id = baseId;
      if (!f.planning_uom_id) patch.planning_uom_id = baseId;
      if (!f.purchase_uom_id) patch.purchase_uom_id = baseId;
      return Object.keys(patch).length ? { ...f, ...patch } : f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, form.fabric_structure_id, structureCodeById, unitIdByCode]);

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
  // Fabric: default UOM from the Structure/Type (2026-07-24 — Circular=KGS,
  // Flat=KGS, Woven=MTR). Single unit per structure; pure lookup, no ref access.
  function structureUomHint(code: string | null): { baseId?: string; secondaryId?: string } {
    if (!code) return {};
    const hint = FABRIC_STRUCTURE_UOM[code];
    if (!hint) return {};
    return {
      baseId: unitIdByCode.get(hint.base),
      secondaryId: hint.secondary ? unitIdByCode.get(hint.secondary) : undefined,
    };
  }
  // Fabric Structure comes from the Category (0279 #17/#18) — picking a category
  // sets category_id, derives the fabric_structure_id off that row, and applies
  // that structure's default UOM to EVERY UOM field (Circular/Flat=KGS, Woven=MTR).
  // We overwrite here (not fill-if-empty) so switching the Type re-applies the new
  // default; the user can still edit any UOM afterwards, and the fabric effect
  // above only backfills blanks (e.g. opening a legacy record). Top-level handler
  // (same shape as addMix/delMix) so it stays in an event-only spot.
  function handleFabricCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId) ?? null;
    const structureId = cat?.fabric_structure_id ?? "";
    const code = structureId ? structureCodeById.get(structureId) ?? null : null;
    const { baseId } = structureUomHint(code);
    set({
      category_id: categoryId,
      fabric_structure_id: structureId,
      ...(baseId
        ? {
            base_uom_id: baseId,
            stock_uom_id: baseId,
            billing_uom_id: baseId,
            planning_uom_id: baseId,
            purchase_uom_id: baseId,
          }
        : {}),
    });
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
        stock_uom_id: form.stock_uom_id || null,
        billing_uom_id: form.billing_uom_id || null,
        planning_uom_id: form.planning_uom_id || null,
        purchase_uom_id: form.purchase_uom_id || null,
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
  const uomSelect = (value: string, onChange: (v: string) => void, limitTo?: Set<string>) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="text-base md:text-sm">
      <option value="">— None —</option>
      {units
        .filter((u) => (limitTo ? limitTo.has(u.id) : u.is_active) || u.id === value)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.code}
          </option>
        ))}
    </Select>
  );

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
  const uomLimit = form.has_alternate_uom && convUnitIds.size > 0 ? convUnitIds : undefined;

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
            commodities={commodities}
            itemClasses={itemClasses}
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
            <Label htmlFor="mt-item-type">Item Type</Label>
            <Input
              id="mt-item-type"
              uppercase
              placeholder="BRUSH"
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

  // Live auto-name generator (0279) — Yarn: Count + Purity + Category/Mixing%;
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
        if (filled.length) parts.push(filled.map((m) => `${m.pct}% ${m.label}`).join(" / "));
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
        const comps = isSingleYarnFabric
          ? filled[0].label
          : filled.map((m) => (isYarnDyedFabric ? m.label : `${m.label} ${m.pct}%`)).join(", ");
        return `${head}${head ? " " : ""}(${comps}) 100%`.toUpperCase();
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
  const dupError = useDuplicateCheck({
    table: "items",
    name: form.name ?? "",
    scope: { item_class_id: form.item_class_id || null },
    excludeId: editId ?? undefined,
    enabled: !!(form.name && form.item_class_id),
  });
  // Synchronous duplicate detection against the loaded rows, so aria-invalid is
  // set in the SAME render as the typed name (client 2026-07-24). The async
  // check above is debounced + server round-trips, so on its own a fast Enter
  // slips past before dupError lands; this local flag closes that race. The
  // server check stays the authoritative backstop (rows not held in memory).
  const nameNorm = form.name.trim().toLowerCase();
  const localNameDuplicate =
    !!nameNorm &&
    rows.some(
      (r) =>
        r.id !== editId &&
        (r.item_class_id ?? "") === (form.item_class_id ?? "") &&
        (r.name ?? "").trim().toLowerCase() === nameNorm,
    );
  const nameDuplicate = localNameDuplicate || !!dupError;
  const dupMessage =
    dupError ??
    (localNameDuplicate ? `"${form.name.trim()}" already exists. Use a different name.` : null);

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
    const compCell = (m: MixRow) => (
      <ItemPicker
        label=""
        title="Component Yarn"
        items={yarnItems.filter((y) => y.is_active || y.id === m.component_item_id)}
        value={m.component_item_id}
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
      return (
        <ChildGrid<MixRow>
          label="Attributes (Mixing)"
          badge={hidePct ? undefined : pctBadge}
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
            column. Structure is the only long value here — Type and Fabric Type
            are single words, so they no longer take a half row each. */}
        <DetailSection label="Classification" cols={12}>
            <Field size="lg">
              <CategoryPicker
                label="Structure"
                categories={scopedCategories}
                value={form.category_id}
                onChange={handleFabricCategoryChange}
                itemClassId={form.item_class_id}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                commodities={commodities}
                itemClasses={itemClasses}
                fabricStructures={fabricStructures}
              />
            </Field>
            <Field size="sm">
              {/* Fabric "Type" — Circular Knit/Flat Knit/Woven. Derived from the
                  picked Structure/category (which already carries its structure,
                  set in the Category child) and shown read-only — no separate
                  list to pick from here (user 2026-07-24). */}
              <Label htmlFor="mt-fabric-structure" className="flex items-center gap-1">
                Type
                <span title="Circular Knit, Flat Knit or Woven — comes from the Structure/category and sets the default UOM (Circular/Flat = KGS, Woven = MTR)." className="cursor-help text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                </span>
              </Label>
              <div
                id="mt-fabric-structure"
                className="flex h-9 items-center truncate rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground"
              >
                {fabricStructures.find((s) => s.id === form.fabric_structure_id)?.name ?? "— Pick a Structure —"}
              </div>
            </Field>
            <Field size="sm">
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
            <Field size="sm">
              <label className="flex h-9 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
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
                categories={scopedCategories}
                value={form.category_id}
                onChange={(v) => set({ category_id: v })}
                itemClassId={form.item_class_id}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                commodities={commodities}
                itemClasses={itemClasses}
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
    { header: "Created User", cell: (r) => <span className="text-xs text-muted-foreground">{r.created_by ?? "—"}</span> },
    { header: "Created Dt", cell: (r) => <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span> },
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
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No materials yet." />
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
                (formKey === "FABRIC" && !form.fabric_type_id) ||
                (!!form.item_class_id && !form.base_uom_id) ||
                singleYarnOverflow ||
                mixPctSumInvalid ||
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
              <Label htmlFor="mt-item-class">Item Class</Label>
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
                aria-invalid={nameDuplicate ? true : undefined}
                className={cn(
                  "text-base md:text-sm",
                  nameDuplicate && "border-danger",
                  (attributeDriven || formKey === "GEN") && "bg-surface-muted",
                )}
              />
              {dupMessage && <p className="mt-1 text-xs text-danger">{dupMessage}</p>}
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
              duplicate-name error simply gates Save. */}
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
              {/* Composition grids belong on the LEFT with the class fields —
                  global rule (Screenshot 2084): LEFT = what the material is,
                  RIGHT = how it's measured. Fabric's grid nests in Composition
                  above; Yarn Mixing and Using (Items) render here. */}
              {yarnMixingVisible && mixingGrid("yarn")}
              {/* Using (Items) is a General-item concept only. Accessories
                  (SEW/PACK) list their configured attributes instead (client
                  2026-07-25). */}
            </SectionColumn>

            {/* RIGHT: pure measurement for ALL classes — Units of Measure,
                Conversions, status. Composition grids never render here. */}
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
                    rather than by luck. */}
                <Field label="Base" size="xs">
                  {uomSelect(form.base_uom_id, (v) => set({ base_uom_id: v }), uomLimit)}
                </Field>
                {/* The `&nbsp;` is a spacer, not decoration: `Field` renders its
                    <Label> only when `label != null`, so an unlabelled cell
                    starts a label's height higher than the labelled Base beside
                    it. `h-9 @2xl/editor:h-8` tracks the Combobox's own height —
                    hard-coding h-9 left the checkbox 4px taller than the select
                    on the wide editor surface. */}
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
                {/* Conversions as one inline row per record — the legacy wide
                    table doesn't fit a half-width column, and the previous
                    2-col card wrapped four controls onto two lines. Quantities
                    are numeric so they get a fixed narrow track; the UOM pickers
                    share the remaining space. Spans the whole 12-col track: it
                    is a table, not a field. */}
                {form.has_alternate_uom && (
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
                        { header: "Alt UOM", cell: (c) => uomSelect(c.alt_uom_id, (v) => setConv(c.key, { alt_uom_id: v })) },
                        {
                          header: "Base qty",
                          align: "center",
                          width: "4.5rem",
                          cell: (c) => <Input type="number" step="0.0001" placeholder="Qty" value={c.base_qty} onChange={(e) => setConv(c.key, { base_qty: e.target.value })} className="text-center" />,
                        },
                        { header: "Base UOM", cell: (c) => uomSelect(c.base_uom_id, (v) => setConv(c.key, { base_uom_id: v })) },
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
                    on row 1 beside the toggle, in this same track 1. */}
                {form.has_alternate_uom && (
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
   *  save the record, Tab closes without choosing and lets focus move on, Esc
   *  closes the list only. */
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
        // reach `enterSaves` and commit the whole material.
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
        // closed, so Enter there still saves the record. The list drops on
        // click, on ↓, or as soon as the operator types.
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
