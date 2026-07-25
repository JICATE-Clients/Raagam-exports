"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
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
import { deletedToast } from "@/lib/masters/delete-message";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { LookupDialogPicker, CategoryPicker, ItemPicker } from "@/components/masters/lookup-picker";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid } from "@/components/masters/child-grid";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  MATERIAL_FORMS,
  MATERIAL_TYPES,
  FABRIC_USING,
  FABRIC_STRUCTURE_UOM,
  itemClassForm,
  type Material,
  type MaterialInput,
  type DetailFieldKey,
  type MaterialFormKey,
} from "@/lib/masters/material-types";
import type { ConfigLookup, Attribute, AttributeValue } from "@/lib/masters/extras-types";
import type { MaterialAttribute } from "@/lib/masters/material-attribute-types";
import type { Category } from "@/lib/masters/category-types";
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
  material_type: "",
  user_defined: false,
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
  const unitCodeById = useMemo(() => new Map(units.map((u) => [u.id, u.code.toUpperCase()])), [units]);
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
  // Every other Material (any item class) — General's "Using (Items)" grid can
  // reference anything, just not the record currently being edited.
  const usingItemOptions = useMemo(() => rows.filter((r) => r.id !== editId), [rows, editId]);
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
  const formDef = formKey === "A" || formKey === "C" ? MATERIAL_FORMS[formKey] : null;
  const selectedCategory = categories.find((c) => c.id === form.category_id) ?? null;
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

  // Accessories (Sewing/Packing) are stocked/billed/planned/purchased in Numbers.
  // Backfill every empty UOM to the Numbers unit — same fill-blanks-only shape as
  // the Yarn KG default, so a manual override always survives.
  useEffect(() => {
    if (formKey !== "A" || !["SEW", "PACK"].includes(selectedClassCode ?? "")) return;
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
  }, [formKey, selectedClassCode, numbersUnitId]);

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
  // A category drives the attribute flow only when User Defined = No (client
  // 2026-07-24). Yes = manual free-text name (like General); No = the system
  // asks the configured questions and auto-generates the name.
  const attributeDriven = formKey === "A" && selectedCategory?.user_defined === false;
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
        };
      });
  }, [attributeDriven, matchedAttrSet, attributeValueById]);
  const attrSeparator = matchedAttrSet?.name_separator ?? " ";
  const attrMandatoryMissing = attrQuestions.some((q) => q.mandatory && !(answers[q.lineId] ?? "").trim());
  // Discrete values generated from a numeric range (e.g. GSM 100→500 step 100 →
  // 100, 200, 300, 400, 500) — rendered as a dropdown, not a free number box.
  const stepValues = (start: number | null, end: number | null, step: number | null): number[] => {
    if (start == null || end == null || !step || step <= 0 || end < start) return [];
    const out: number[] = [];
    for (let v = start; v <= end + 1e-9 && out.length < 1000; v += step) out.push(Number(v.toFixed(4)));
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
  function handleItemClassChange(v: string) {
    set({ item_class_id: v, category_id: "" });
  }

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
      material_type: r.material_type ?? "",
      user_defined: r.user_defined,
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
  const addUsingRow = () => setUsingItems((xs) => [...xs, { key: newKey(), used_item_id: "", description: "", shade: "", uom_id: "" }]);
  const setUsingRow = (key: string, patch: Partial<UsingItemRow>) => setUsingItems((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delUsingRow = (key: string) => setUsingItems((xs) => xs.filter((r) => r.key !== key));

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
        material_type: form.material_type || null,
        user_defined: form.user_defined,
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
  const uomSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="text-base md:text-sm">
      <option value="">— None —</option>
      {units
        .filter((u) => u.is_active || u.id === value)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.code}
          </option>
        ))}
    </Select>
  );

  /**
   * How wide each Classification field should be, on the 12-column track.
   *
   * Sized to the data, not to the grid: "User defined" is a Yes/No, Count is
   * "40'S", Purity is a word — none of them need the half-row they used to get
   * (client 2026-07-24 #3). Description is the only genuinely long free text.
   * Adjust here, not at the call sites — this map is the single source of truth
   * for the generic classes (General / SEW / PACK / CAP / Garments).
   */
  const DETAIL_FIELD_SIZE: Record<DetailFieldKey, FieldSize> = {
    category_id: "md", // picker, shows a category name
    material_type: "sm", // Purchased / Converted / Production
    user_defined: "xs", // Yes / No
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
        );
      case "material_type": {
        // For Sewing/Packing this is the accessory "Transaction Type" — Production
        // is removed, leaving Purchased / Converted (client 2026-07-24).
        const isAccessory = ["SEW", "PACK"].includes(selectedClassCode ?? "");
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
      case "user_defined":
        return (
          <div key={key}>
            <Label>User defined</Label>
            <Select value={form.user_defined ? "yes" : "no"} onChange={(e) => set({ user_defined: e.target.value === "yes" })} className="text-base md:text-sm">
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </div>
        );
      case "specifications":
        return (
          <div key={key}>
            <Label>Description</Label>
            <Input value={form.specifications} onChange={(e) => set({ specifications: e.target.value })} className="text-base md:text-sm" />
          </div>
        );
      case "short_spec":
        return (
          <div key={key}>
            <Label>Short Spec</Label>
            <Input value={form.short_spec} onChange={(e) => set({ short_spec: e.target.value })} className="text-base md:text-sm" />
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
            <Input value={form.shade} onChange={(e) => set({ shade: e.target.value })} className="text-base md:text-sm" />
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
    // SEW/PACK attribute-driven (User Defined = No): Category ‹sep› answers ‹sep›
    // Description (client 2026-07-24) — e.g. "LABEL - MAIN LABEL - PRINTED - …".
    if (attributeDriven && attrQuestions.length) {
      const answerParts = attrQuestions.map((q) => (answers[q.lineId] ?? "").trim());
      const parts = [selectedCategory?.name, ...answerParts, form.specifications.trim()].filter(Boolean);
      return parts.length ? parts.join(attrSeparator).toUpperCase() : null;
    }
    return null;
  }, [formKey, attributeDriven, form.count_id, form.purity_id, form.fabric_type_id, form.specifications, selectedCategory, mixings, countLabel, purityLabel, fabricTypeLabel, yarnItemName, attrQuestions, answers, attrSeparator, isYarnDyedFabric, isSingleYarnFabric]);

  // Auto-write the generated name for Yarn/Fabric (suggestedName is null for
  // other classes, so General/etc. stay manual). Depends on suggestedName only —
  // the value-compare guards against the effect looping on its own set().
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
    const pctBadge = mixings.length > 0 && (
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
          { header: "Shade", width: "7rem", cell: (m) => <Input placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} /> },
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
                  2070): users must pick, never grow this list. */}
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
                <Select value={form.fabric_using} onChange={(e) => set({ fabric_using: e.target.value })}>
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
              <div className="space-y-2 sm:col-span-12">
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
            <Field label="Yarn Type" size="md" htmlFor="mt-yarn-type">
              <Select
                id="mt-yarn-type"
                value={form.yarn_type_id}
                onChange={(e) => handleYarnTypeChange(e.target.value)}
              >
                <option value="">— Select —</option>
                {yarnTypes
                  .filter((y) => y.is_active || y.id === form.yarn_type_id)
                  .map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {/* Melange yarn carries its shade (client 2026-07-23) */}
            {ytName === "melange" && (
              <Field label="Shade" size="sm" htmlFor="mt-yarn-shade">
                <Input
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
            <Field label="Count" size="sm" htmlFor="mt-yarn-count">
              {/* Plain dropdown, no Add/Modify/Delete (client 2026-07-23 #4) —
                  counts are a fixed list users pick from, never grow here. */}
              <Select
                id="mt-yarn-count"
                value={form.count_id}
                onChange={(e) => set({ count_id: e.target.value })}
              >
                <option value="">— Select —</option>
                {counts
                  .filter((c) => c.is_active || c.id === form.count_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
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

  /** "Using (Items)" — General item class only: which other items (any item
   *  class) this material uses, plus Shade/UOM per line (0304). Rows link a
   *  real Item via `ItemPicker` only — no free-text Description (user
   *  2026-07-23, same rule as the Attributes/Mixing grids; `description`
   *  stays in row data for legacy rows). */
  function usingItemsGrid() {
    const descCell = (u: UsingItemRow) => (
      <ItemPicker label="" items={usingItemOptions.filter((x) => x.is_active || x.id === u.used_item_id)} value={u.used_item_id} onChange={(v) => setUsingRow(u.key, { used_item_id: v })} />
    );
    return (
      <ChildGrid<UsingItemRow>
        label="Using (Items)"
        inlineCards
        rows={usingItems}
        onAdd={addUsingRow}
        onRemove={(u) => delUsingRow(u.key)}
        columns={[
          { header: "Item", cell: descCell },
          { header: "Shade", width: "7rem", cell: (u) => <Input value={u.shade} onChange={(e) => setUsingRow(u.key, { shade: e.target.value })} /> },
          { header: "Uom", width: "5.5rem", cell: (u) => uomSelect(u.uom_id, (v) => setUsingRow(u.key, { uom_id: v })) },
        ]}
      />
    );
  }

  const uomCell = (id: string | null) => <span className="text-xs text-muted-foreground">{id ? unitCodeById.get(id) ?? "—" : "—"}</span>;

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
    { header: "HSN Code", cell: (r) => <span className="text-xs text-muted-foreground">{r.hsn_code ?? "—"}</span> },
    { header: "Base", cell: (r) => uomCell(r.base_uom_id) },
    { header: "Stock", cell: (r) => uomCell(r.stock_uom_id) },
    { header: "Billing", cell: (r) => uomCell(r.billing_uom_id) },
    { header: "Planning", cell: (r) => uomCell(r.planning_uom_id) },
    { header: "Purchase", cell: (r) => uomCell(r.purchase_uom_id) },
    { header: "Created User", cell: (r) => <span className="text-xs text-muted-foreground">{r.created_by ?? "—"}</span> },
    { header: "Created Dt", cell: (r) => <span className="text-xs text-muted-foreground">{r.created_at ? r.created_at.slice(0, 10) : "—"}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
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

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No materials yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                </div>
                <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
              </div>
              {r.item_class_id && <div className="mt-2 text-[13px] text-muted-foreground">{classLabel.get(r.item_class_id)}</div>}
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
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)_10rem]">
            <div>
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
                // Auto-generated name (Yarn/Fabric/attribute classes) → skip Tab,
                // but stay clickable so it can still be hand-overridden. Manual
                // classes (General) keep the name in Tab order. See global rule.
                // Attribute-driven accessories can't be named manually (spec) —
                // the name is fully generated from Category + attributes + Description.
                tabIndex={suggestedName ? -1 : undefined}
                readOnly={attributeDriven}
                aria-invalid={nameDuplicate ? true : undefined}
                className={cn(
                  "text-base md:text-sm",
                  nameDuplicate && "border-danger",
                  attributeDriven && "bg-surface-muted",
                )}
              />
              {dupMessage && <p className="mt-1 text-xs text-danger">{dupMessage}</p>}
              {!editId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  The code is generated automatically from the name.
                </p>
              )}
            </div>
            <LookupDialogPicker
              kind="hsn_code"
              label="HSN Code"
              options={hsnCodes}
              value={form.hsn_id}
              onChange={(v) => set({ hsn_id: v })}
            />
          </div>

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
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              {formKey === "FABRIC" ? (
                fabricDetails()
              ) : formKey === "YARN" ? (
                yarnDetails()
              ) : (
                // Generic classes (General/SEW/PACK/CAP/Garments) share the
                // same dense 2-col layout as Yarn/Fabric — global form rule.
                <DetailSection label="Classification" cols={12}>{formDef?.fields.map((k) => detailField(k))}</DetailSection>
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
              {/* 12-col track: a numeric answer is a 2-4 character box, an
                  option list needs room for its longest option. Sizing each to
                  its data fits 3-4 attributes per row instead of 2 wide,
                  half-empty ones (client 2026-07-24 #3). A Value-In-Steps line
                  becomes a dropdown of its generated steps; a value-list line a
                  dropdown of its own values; anything else a free number box. */}
              {attrQuestions.length > 0 && (
                <DetailSection label="Attributes" cols={12}>
                  {attrQuestions.map((q) => {
                    const steps = q.valueInSteps ? stepValues(q.start, q.end, q.step) : [];
                    const asDropdown = q.valueInSteps ? steps.length > 0 : q.options.length > 0;
                    const choices = q.valueInSteps ? steps.map(String) : q.options;
                    return (
                      <Field key={q.lineId} label={q.label} required={q.mandatory} size={asDropdown ? "md" : "sm"}>
                        {asDropdown ? (
                          <Select
                            value={answers[q.lineId] ?? ""}
                            onChange={(e) => setAnswers((a) => ({ ...a, [q.lineId]: e.target.value }))}
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
                          />
                        )}
                      </Field>
                    );
                  })}
                </DetailSection>
              )}
              {/* Composition grids belong on the LEFT with the class fields —
                  global rule (Screenshot 2084): LEFT = what the material is,
                  RIGHT = how it's measured. Fabric's grid nests in Composition
                  above; Yarn Mixing and Using (Items) render here. */}
              {yarnMixingVisible && mixingGrid("yarn")}
              {["GEN", "PACK", "SEW"].includes(selectedClassCode ?? "") && usingItemsGrid()}
            </div>

            {/* RIGHT: pure measurement for ALL classes — Units of Measure,
                Conversions, status. Composition grids never render here. */}
            <div className="space-y-4">
              {/* Every UOM is a 2-4 character code (KG, MTR, PCS), so each gets
                  a narrow track — five fit in two rows instead of sprawling
                  across two wide columns (client 2026-07-24 #3). */}
              <DetailSection label="Units of Measure" cols={12}>
                <Field label="Base Uom" size="sm">
                  {uomSelect(form.base_uom_id, (v) => set({ base_uom_id: v }))}
                </Field>
                <Field label="Stock Uom" size="sm">
                  {uomSelect(form.stock_uom_id, (v) => set({ stock_uom_id: v }))}
                </Field>
                <Field label="Billing Uom" size="sm">
                  {uomSelect(form.billing_uom_id, (v) => set({ billing_uom_id: v }))}
                </Field>
                <Field label="Planning Uom" size="sm">
                  {uomSelect(form.planning_uom_id, (v) => set({ planning_uom_id: v }))}
                </Field>
                <Field label="Purchase Uom" size="sm">
                  {uomSelect(form.purchase_uom_id, (v) => set({ purchase_uom_id: v }))}
                </Field>
              </DetailSection>

              {/* Conversions as one inline row per record — the legacy wide
                  table doesn't fit a half-width column, and the previous
                  2-col card wrapped four controls onto two lines. Quantities
                  are numeric so they get a fixed narrow track; the UOM pickers
                  share the remaining space. */}
              <ChildGrid<ConvRow>
                label="Alternate ↔ Base Conversions"
                rows={conversions}
                onAdd={addConv}
                onRemove={(c) => delConv(c.key)}
                addLabel="+ Add conversion"
                inlineCards
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

              {/* Budget + Cost Rate removed from the data path (client walkthrough,
                  0279) — no longer edited or written from this screen. The DB
                  columns remain, so any existing values are left untouched. */}

              {editId && (
                <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-3">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => set({ inactive: e.target.checked })} />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              )}
            </div>
          </div>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
