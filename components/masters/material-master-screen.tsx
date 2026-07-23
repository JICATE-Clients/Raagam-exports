"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [section, setSection] = useState<"details" | "uom">("details");
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
  // Every other Material (any item class) — General's "Using (Items)" grid can
  // reference anything, just not the record currently being edited.
  const usingItemOptions = useMemo(() => rows.filter((r) => r.id !== editId), [rows, editId]);
  const structureCodeById = useMemo(() => new Map(fabricStructures.map((s) => [s.id, s.code])), [fabricStructures]);
  // Lowercased keys — UOM codes are data ("kg" vs "KG" both occur); the
  // Yarn-kg default and fabric-structure UOM hints must not miss on case.
  const unitIdByCode = useMemo(() => new Map(units.map((u) => [u.code.toLowerCase(), u.id])), [units]);
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
  // The ordered questions to render — only for the generic (SEW/PACK/GEN) form.
  const attrQuestions = useMemo(() => {
    if (formKey !== "A" || !matchedAttrSet) return [];
    return [...matchedAttrSet.lines]
      .filter((l) => !l.inactive && l.attribute_id)
      .sort((a, b) => a.sno - b.sno)
      .map((l) => {
        const av = l.attribute_id ? attributeValueById.get(l.attribute_id) : undefined;
        return {
          lineId: l.id,
          sno: l.sno,
          label: av?.value ?? "Attribute",
          inputType: av?.input_type ?? "numeric_range",
          options: (av?.options ?? []).map((o) => o.value),
          mandatory: l.mandatory,
          start: l.start_value,
          end: l.end_value,
          step: l.step_value,
        };
      });
  }, [formKey, matchedAttrSet, attributeValueById]);
  const attrSeparator = matchedAttrSet?.name_separator ?? " ";
  const attrMandatoryMissing = attrQuestions.some((q) => q.mandatory && !(answers[q.lineId] ?? "").trim());
  const structureCode = form.fabric_structure_id
    ? structureCodeById.get(form.fabric_structure_id) ?? null
    : null;

  // Fabric: auto-derive UOM from Type (0279/0301 — Circular=kg, Flat
  // Knit=numbers+weight, Woven=meters+kg). Pure lookup only — no ref access.
  function structureUomHint(code: string | null): { baseId?: string; secondaryId?: string } {
    if (!code) return {};
    const hint = FABRIC_STRUCTURE_UOM[code];
    if (!hint) return {};
    return {
      baseId: unitIdByCode.get(hint.base),
      secondaryId: hint.secondary ? unitIdByCode.get(hint.secondary) : undefined,
    };
  }
  // Fabric Structure now comes from the Category (0279 #17/#18) — picking a
  // category sets category_id, derives the fabric_structure_id off that row,
  // and auto-fills the UOM from that structure (Circular=kg, Flat=nos+kg,
  // Woven=mtr+kg). Top-level handler (same shape as addMix/delMix) so
  // newKey()'s ref read stays in a spot the compiler proves is event-only —
  // nesting it in the fabricDetails() render-helper trips react-hooks/refs.
  function handleFabricCategoryChange(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId) ?? null;
    const structureId = cat?.fabric_structure_id ?? "";
    const code = structureId ? structureCodeById.get(structureId) ?? null : null;
    const { baseId, secondaryId } = structureUomHint(code);
    set({
      category_id: categoryId,
      fabric_structure_id: structureId,
      ...(baseId && !form.base_uom_id ? { base_uom_id: baseId, stock_uom_id: baseId } : {}),
    });
    if (baseId && secondaryId && conversions.length === 0) {
      setConversions([{ key: newKey(), alt_qty: "", alt_uom_id: baseId, base_qty: "", base_uom_id: secondaryId }]);
    }
  }
  // Fabric "Type" (Circular Knit/Flat Knit/Woven, kind fabric_structure) — a
  // visible dropdown (client 2026-07-23, Screenshot 2071). Auto-filled when a
  // Structure/category is picked, but user-overridable; changing it re-derives
  // the UOM the same non-destructive way the category handler does. Top-level
  // handler so newKey()'s ref read stays event-only (react-hooks/refs).
  function handleFabricStructureChange(v: string) {
    const code = v ? structureCodeById.get(v) ?? null : null;
    const { baseId, secondaryId } = structureUomHint(code);
    set({
      fabric_structure_id: v,
      ...(baseId && !form.base_uom_id ? { base_uom_id: baseId, stock_uom_id: baseId } : {}),
    });
    if (baseId && secondaryId && conversions.length === 0) {
      setConversions([{ key: newKey(), alt_qty: "", alt_uom_id: baseId, base_qty: "", base_uom_id: secondaryId }]);
    }
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
  // Item Class change: reset the (class-scoped) Category, and default ALL of
  // Yarn's UOMs to kg — yarn is always traded in kg (0279 #15 + client
  // 2026-07-23 follow-up: the UOM tab must SHOW KG preselected). Only fills
  // fields that are still unset, so a user override survives.
  function handleItemClassChange(v: string) {
    const code = itemClasses.find((c) => c.id === v)?.code?.toUpperCase() ?? null;
    if (code === "YARN") {
      const kgId = unitIdByCode.get("kg");
      set({
        item_class_id: v,
        category_id: "",
        ...(kgId
          ? {
              ...(!form.base_uom_id ? { base_uom_id: kgId } : {}),
              ...(!form.stock_uom_id ? { stock_uom_id: kgId } : {}),
              ...(!form.billing_uom_id ? { billing_uom_id: kgId } : {}),
              ...(!form.planning_uom_id ? { planning_uom_id: kgId } : {}),
              ...(!form.purchase_uom_id ? { purchase_uom_id: kgId } : {}),
            }
          : {}),
      });
    } else {
      set({ item_class_id: v, category_id: "" });
    }
  }

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setMixings([]);
    setConversions([]);
    setUsingItems([]);
    setAnswers({});
    setSection("details");
    setOpen(true);
  }
  function openEdit(r: Material) {
    setEditId(r.id);
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
    setSection("details");
    setOpen(true);
  }

  // grid mutators
  const addMix = () =>
    setMixings((xs) => [
      ...xs,
      { key: newKey(), description: "", shade: "", uom_id: "", component_item_id: "", count_id: "", blend_pct: "" },
    ]);
  const setMix = (key: string, patch: Partial<MixRow>) => setMixings((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const mixPctSum = mixings.reduce((sum, m) => sum + (numOrNull(m.blend_pct) ?? 0), 0);
  // Yarn-dyed fabric: the yarns are already dyed before knitting/weaving, so the
  // Attributes grid only lists WHICH yarns go in — a Mixing % doesn't apply.
  // Matched by label so "Yarn Dyed" / "Yarn-dyed" lookup spellings all work.
  const fabricTypeName = (fabricTypeLabel.get(form.fabric_type_id) ?? "").toLowerCase();
  const isYarnDyedFabric = formKey === "FABRIC" && fabricTypeName.includes("yarn") && fabricTypeName.includes("dyed");
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
        mixings: mixings.map((m) => ({
          sno: 0,
          description: m.description || null,
          shade: m.shade || null,
          uom_id: m.uom_id || null,
          component_item_id: m.component_item_id || null,
          count_id: m.count_id || null,
          // Yarn-dyed fabric has no Mixing % — null it so no stale value is
          // stored and the Zod sum-to-100 refine doesn't fire.
          blend_pct: isYarnDyedFabric ? null : numOrNull(m.blend_pct),
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

  // Codes are backend-only (client 2026-07-23) — options show just the name.
  const uomOptions = units.map((u) => (
    <option key={u.id} value={u.id}>
      {u.name}
    </option>
  ));
  const uomSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="text-base md:text-sm">
      <option value="">— None —</option>
      {uomOptions}
    </Select>
  );

  function detailField(key: DetailFieldKey): ReactNode {
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
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        );
      case "material_type":
        return (
          <div key={key}>
            <Label>Type</Label>
            <Select value={form.material_type} onChange={(e) => set({ material_type: e.target.value })} className="text-base md:text-sm">
              <option value="">— Select —</option>
              {MATERIAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        );
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
            <Label>Specifications</Label>
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

  // Live auto-name generator (0279) — Yarn: Count + Category + Purity/Mixing%;
  // Fabric: Structure + Yarn(s) + %. Returns null for other classes (General
  // etc.), which stay manual. For Yarn/Fabric it is written straight into the
  // Name field via the effect below.
  const suggestedName = useMemo(() => {
    if (formKey === "YARN") {
      // Name = Count + Category NAME + Purity (user 2026-07-23: the category's
      // own name, e.g. "cotton mixed", joins the name — not its nature "Mixed").
      const parts = [
        form.count_id ? countLabel.get(form.count_id) : null,
        selectedCategory?.name ?? null,
        form.purity_id ? purityLabel.get(form.purity_id) : null,
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
      const structureName = structureCode ? fabricStructures.find((s) => s.code === structureCode)?.name : null;
      const parts = [structureName, form.fabric_type_id ? fabricTypeLabel.get(form.fabric_type_id) : null].filter(Boolean);
      if (mixings.length) {
        // Yarn-dyed has no Mixing % — name lists just the component yarns.
        // As on Yarn, only completed rows join the name — no "?" placeholders.
        const filled = mixings
          .map((m) => ({
            pct: m.blend_pct,
            label: m.component_item_id ? yarnItemName.get(m.component_item_id) ?? "" : m.description.trim(),
          }))
          .filter((m) => m.label && (isYarnDyedFabric || m.pct));
        if (filled.length) {
          parts.push(filled.map((m) => (isYarnDyedFabric ? m.label : `${m.pct}% ${m.label}`)).join(" / "));
        }
      }
      return parts.join(" ").toUpperCase() || null;
    }
    // SEW/PACK (generic form) with a configured attribute set: join the answers.
    if (formKey === "A" && attrQuestions.length) {
      const parts = attrQuestions.map((q) => (answers[q.lineId] ?? "").trim()).filter(Boolean);
      return parts.length ? parts.join(attrSeparator).toUpperCase() : null;
    }
    return null;
  }, [formKey, form.count_id, form.purity_id, form.fabric_type_id, selectedCategory, mixings, countLabel, purityLabel, fabricTypeLabel, structureCode, fabricStructures, yarnItemName, attrQuestions, answers, attrSeparator, isYarnDyedFabric]);

  // Auto-write the generated name for Yarn/Fabric (suggestedName is null for
  // other classes, so General/etc. stay manual). Depends on suggestedName only —
  // the value-compare guards against the effect looping on its own set().
  useEffect(() => {
    if (suggestedName) {
      setForm((f) => (f.name === suggestedName ? f : { ...f, name: suggestedName }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedName]);

  // Real-time duplicate check on Name, scoped to the selected Item Class.
  const dupError = useDuplicateCheck({
    table: "items",
    name: form.name ?? "",
    scope: { item_class_id: form.item_class_id || null },
    excludeId: editId ?? undefined,
    enabled: !!(form.name && form.item_class_id),
  });

  /** Shared blend/mixing grid — Fabric ("Using" Single/Multiple yarn, Decision 4)
   *  and Yarn (only when Category nature = Mixed, Decision 7). Each row links to
   *  a real Yarn `items` record where possible; % must sum to 100 to save.
   *
   *  `variant: "fabric"` renders the legacy "Attributes" table (# | Description
   *  | Mixing %) — Description still prefers a linked Yarn item, falling back
   *  to free text when none is picked, same as before, just without the Shade
   *  and UOM columns legacy doesn't show here. `variant: "yarn"` shows the
   *  client-confirmed field list Yarn / Mixing % / Shade (update.md #11) —
   *  `uom_id` stays in the row data, just not editable here. */
  function mixingGrid(variant: "fabric" | "yarn" = "yarn") {
    const pctBadge = mixings.length > 0 && (
      <span className={cn("text-xs font-medium", Math.abs(mixPctSum - 100) < 0.01 ? "text-success" : "text-danger")}>
        {mixPctSum}% of 100%
      </span>
    );
    const compCell = (m: MixRow) => (
      <div className="space-y-1">
        <ItemPicker
          label=""
          title="Component Yarn"
          items={yarnItems}
          value={m.component_item_id}
          onChange={(v) => setMix(m.key, { component_item_id: v })}
          placeholder="— Component yarn —"
          quickCreateClassId={yarnClassId ?? undefined}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
        />
        {!m.component_item_id && (
          <Input
            placeholder={variant === "fabric" ? "Description" : "Description (if no linked yarn record)"}
            value={m.description}
            onChange={(e) => setMix(m.key, { description: e.target.value })}
            className="text-base md:text-sm"
          />
        )}
      </div>
    );

    if (variant === "fabric") {
      // Yarn-dyed: percentages don't apply — just list the component yarns.
      return (
        <ChildGrid<MixRow>
          label="Attributes"
          badge={isYarnDyedFabric ? undefined : pctBadge}
          rows={mixings}
          onAdd={addMix}
          onRemove={(m) => delMix(m.key)}
          columns={[
            { header: "Description", cell: compCell },
            ...(isYarnDyedFabric
              ? []
              : [
                  {
                    header: "Mixing %",
                    align: "center" as const,
                    cell: (m: MixRow) => (
                      <Input type="number" step="0.01" placeholder="%" value={m.blend_pct} onChange={(e) => setMix(m.key, { blend_pct: e.target.value })} className="text-base md:text-sm" />
                    ),
                  },
                ]),
          ]}
          renderMobileRow={(m) => (
            <>
              {compCell(m)}
              {!isYarnDyedFabric && (
                <Input type="number" step="0.01" placeholder="Mixing %" value={m.blend_pct} onChange={(e) => setMix(m.key, { blend_pct: e.target.value })} className="text-base md:text-sm" />
              )}
            </>
          )}
        />
      );
    }

    return (
      <ChildGrid<MixRow>
        label="Mixing"
        badge={pctBadge}
        rows={mixings}
        onAdd={addMix}
        onRemove={(m) => delMix(m.key)}
        addLabel="+ Add mixing row"
        columns={[
          { header: "Yarn", cell: compCell },
          { header: "Mixing %", align: "center", cell: (m) => <Input type="number" step="0.01" placeholder="%" value={m.blend_pct} onChange={(e) => setMix(m.key, { blend_pct: e.target.value })} className="text-base md:text-sm" /> },
          { header: "Shade", cell: (m) => <Input placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} className="text-base md:text-sm" /> },
        ]}
        renderMobileRow={(m) => (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <ItemPicker
                label=""
                title="Component Yarn"
                items={yarnItems}
                value={m.component_item_id}
                onChange={(v) => setMix(m.key, { component_item_id: v })}
                placeholder="— Component yarn —"
                quickCreateClassId={yarnClassId ?? undefined}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
              <Input
                type="number"
                step="0.01"
                placeholder="%"
                value={m.blend_pct}
                onChange={(e) => setMix(m.key, { blend_pct: e.target.value })}
                className="w-20 text-base md:text-sm"
              />
            </div>
            {!m.component_item_id && (
              <Input placeholder="Description (if no linked yarn record)" value={m.description} onChange={(e) => setMix(m.key, { description: e.target.value })} className="text-base md:text-sm" />
            )}
            <Input placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} className="text-base md:text-sm" />
          </>
        )}
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
        <DetailSection label="Classification">
            <CategoryPicker
              label="Structure"
              categories={scopedCategories}
              value={form.category_id}
              onChange={handleFabricCategoryChange}
              itemClassId={form.item_class_id}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
            <div>
              {/* Fabric "Type" — Circular Knit/Flat Knit/Woven (Screenshot 2071).
                  Auto-filled from the picked Structure, editable as an override. */}
              <Label htmlFor="mt-fabric-structure">Type</Label>
              <Select
                id="mt-fabric-structure"
                value={form.fabric_structure_id}
                onChange={(e) => handleFabricStructureChange(e.target.value)}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {fabricStructures
                  .filter((s) => s.is_active || s.id === form.fabric_structure_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Circular Knit, Flat Knit or Woven — sets the UOM (kg / nos+kg / mtr+kg).</p>
            </div>
            <div>
              {/* Fixed 3-value classification (Solid/Yarn Dyed/Melange) — plain
                  dropdown, no Add/Modify/Delete (client 2026-07-23, Screenshot
                  2070): users must pick, never grow this list. */}
              <Label htmlFor="mt-fabric-type">
                Fabric Type <span className="text-danger">*</span>
              </Label>
              <Select
                id="mt-fabric-type"
                value={form.fabric_type_id}
                onChange={(e) => handleFabricTypeChange(e.target.value)}
                className="text-base md:text-sm"
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
              <p className="mt-1 text-xs text-muted-foreground">Solid, Yarn Dyed or Melange — determines the dyeing PO type.</p>
            </div>
            {/* Melange fabric carries its shade (client 2026-07-23) */}
            {fabricTypeLabel.get(form.fabric_type_id)?.toLowerCase() === "melange" && (
              <div>
                <Label htmlFor="mt-fabric-shade">Shade</Label>
                <Input
                  id="mt-fabric-shade"
                  value={form.shade}
                  onChange={(e) => set({ shade: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            )}
        </DetailSection>
        <DetailSection label="Composition">
            <label className="flex cursor-pointer items-center gap-2">
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
            {!form.direct_purchase && (
              <div>
                <Label>Using</Label>
                <Select value={form.fabric_using} onChange={(e) => set({ fabric_using: e.target.value })} className="text-base md:text-sm">
                  <option value="">— None —</option>
                  {FABRIC_USING.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </div>
            )}
        </DetailSection>
        {!form.direct_purchase && mixingGrid("fabric")}
      </>
    );
  }

  /** Yarn Details (0279) — Nature (categories.made) ALONE drives Mixing.
   *  FINAL rule (user, 2026-07-23, latest instruction — supersedes both the
   *  earlier twisted/doubling gate and the Manmade-shows variant):
   *  Natural → hide, Manmade → hide, Mixed → show. A pure Manmade yarn
   *  (100% polyester) is not a blend; only a Mixed-nature category is.
   *  Yarn Type (Grey/Melange/Twisted/Doubling) does NOT affect Mixing
   *  visibility — a Grey poly-cotton blend still records its 60/40. */
  function yarnDetails() {
    const nature = selectedCategory?.made ?? null;
    const ytName = yarnTypes.find((y) => y.id === form.yarn_type_id)?.name?.toLowerCase() ?? null;
    const mixingAllowed = nature === "Mixed";
    return (
      <>
        <DetailSection label="Yarn Type">
            <div>
              <Label htmlFor="mt-yarn-type">Yarn Type</Label>
              <Select
                id="mt-yarn-type"
                value={form.yarn_type_id}
                onChange={(e) => handleYarnTypeChange(e.target.value)}
                className="text-base md:text-sm"
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
            </div>
            {/* Melange yarn carries its shade (client 2026-07-23) */}
            {ytName === "melange" && (
              <div>
                <Label htmlFor="mt-yarn-shade">Shade</Label>
                <Input
                  id="mt-yarn-shade"
                  value={form.shade}
                  onChange={(e) => set({ shade: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            )}
        </DetailSection>
        <DetailSection label="Classification">
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
            <CategoryPicker
              label="Category"
              categories={scopedCategories}
              value={form.category_id}
              onChange={(v) => set({ category_id: v })}
              itemClassId={form.item_class_id}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
            {nature && (
              <div>
                <Label>Nature</Label>
                <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground">{nature}</div>
              </div>
            )}
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
        </DetailSection>
        {mixingAllowed && mixingGrid("yarn")}
      </>
    );
  }

  /** "Using (Items)" — General item class only: which other items (any item
   *  class) this material uses, plus Shade/UOM per line (0304). Description
   *  prefers a linked Item via `ItemPicker`, falling back to free text when
   *  none is picked — same dual-mode as the Fabric Attributes grid. */
  function usingItemsGrid() {
    const descCell = (u: UsingItemRow) => (
      <div className="space-y-1">
        <ItemPicker label="" items={usingItemOptions} value={u.used_item_id} onChange={(v) => setUsingRow(u.key, { used_item_id: v })} />
        {!u.used_item_id && (
          <Input placeholder="Description" value={u.description} onChange={(e) => setUsingRow(u.key, { description: e.target.value })} className="text-base md:text-sm" />
        )}
      </div>
    );
    return (
      <ChildGrid<UsingItemRow>
        label="Using (Items)"
        rows={usingItems}
        onAdd={addUsingRow}
        onRemove={(u) => delUsingRow(u.key)}
        columns={[
          { header: "Description", cell: descCell },
          { header: "Shade", cell: (u) => <Input value={u.shade} onChange={(e) => setUsingRow(u.key, { shade: e.target.value })} className="text-base md:text-sm" /> },
          { header: "Uom", cell: (u) => uomSelect(u.uom_id, (v) => setUsingRow(u.key, { uom_id: v })) },
        ]}
        renderMobileRow={(u) => (
          <>
            {descCell(u)}
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Shade" value={u.shade} onChange={(e) => setUsingRow(u.key, { shade: e.target.value })} className="text-base md:text-sm" />
              {uomSelect(u.uom_id, (v) => setUsingRow(u.key, { uom_id: v }))}
            </div>
          </>
        )}
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

  const tabBtn = (id: "details" | "uom", label: string) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        section === id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

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
        title={editId ? "Edit Material" : "New Material"}
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
                attrMandatoryMissing ||
                !!dupError
              }
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* header: Item Class + HSN */}
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
          <LookupDialogPicker
            kind="hsn_code"
            label="HSN Code"
            options={hsnCodes}
            value={form.hsn_id}
            onChange={(v) => set({ hsn_id: v })}
          />

          {/* section toggle */}
          <div className="flex gap-1 rounded-lg border border-border bg-surface-muted p-1">
            {tabBtn("details", "Details")}
            {tabBtn("uom", "UOM")}
          </div>

          {/* DETAILS section — fields depend on Item Class */}
          {section === "details" && (
            <div className="space-y-4">
              {!form.item_class_id ? (
                <p className="text-xs text-muted-foreground">Select an Item Class above to see its detail fields.</p>
              ) : formKey === "FABRIC" ? (
                fabricDetails()
              ) : formKey === "YARN" ? (
                yarnDetails()
              ) : (
                <DetailSection label="Classification">{formDef?.fields.map((k) => detailField(k))}</DetailSection>
              )}
              {formKey === "A" && attrQuestions.length > 0 && (
                <DetailSection label="Attributes" cols={2}>
                  {attrQuestions.map((q) => (
                    <div key={q.lineId}>
                      <Label>
                        {q.label}
                        {q.mandatory && <span className="text-danger"> *</span>}
                      </Label>
                      {q.inputType === "option_list" ? (
                        <Select
                          value={answers[q.lineId] ?? ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [q.lineId]: e.target.value }))}
                          className="text-base md:text-sm"
                        >
                          <option value="">— Select —</option>
                          {q.options.map((opt) => (
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
                    </div>
                  ))}
                </DetailSection>
              )}
              {["GEN", "PACK", "SEW"].includes(selectedClassCode ?? "") && usingItemsGrid()}

              {/* Name (common) — auto-generated for Yarn/Fabric, manual otherwise */}
              <div className="border-t border-border pt-3">
                <Label htmlFor="mt-name">
                  Name <span className="text-danger">*</span>
                </Label>
                <Input id="mt-name" uppercase value={form.name} onChange={(e) => set({ name: e.target.value })} className="text-base md:text-sm" />
                {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
                {!editId && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    The code is generated automatically from the name.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* UOM section — common to all classes */}
          {section === "uom" && (
            <div className="space-y-4">
              <div>
                <Label>Base Uom</Label>
                {uomSelect(form.base_uom_id, (v) => set({ base_uom_id: v }))}
              </div>

              {/* conversion grid — mirrors the legacy SlNo | Alternate (Qty, Uom) | = | Base (Qty, Uom) table.
                  @container: the table/card split is driven by this grid's own width, not the
                  browser viewport — the Sheet is a fixed ~420px drawer, so `md:` would show the
                  wide table even though there's only ~380px of real room, clobbering the columns. */}
              <div className="@container space-y-2 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alternate ↔ Base conversions</div>

                {/* wide-container table */}
                <div className="hidden overflow-x-auto rounded-lg border border-border @lg:block">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th rowSpan={2} className="w-10 px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">#</th>
                        <th colSpan={2} className="border-l border-border px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Alternate</th>
                        <th rowSpan={2} className="w-8 border-l border-border px-1 py-1.5 text-center text-xs font-semibold text-muted-foreground">=</th>
                        <th colSpan={2} className="border-l border-border px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">Base</th>
                        <th rowSpan={2} className="w-8 border-l border-border" />
                      </tr>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="border-l border-border px-2 py-1.5 text-xs font-medium text-muted-foreground">Qty</th>
                        <th className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Uom</th>
                        <th className="border-l border-border px-2 py-1.5 text-xs font-medium text-muted-foreground">Qty</th>
                        <th className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Uom</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversions.map((c, i) => (
                        <tr key={c.key} className="border-b border-border last:border-0">
                          <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{i + 1}</td>
                          <td className="border-l border-border px-2 py-1.5">
                            <Input type="number" step="0.0001" value={c.alt_qty} onChange={(e) => setConv(c.key, { alt_qty: e.target.value })} className="text-base md:text-sm" />
                          </td>
                          <td className="px-2 py-1.5">{uomSelect(c.alt_uom_id, (v) => setConv(c.key, { alt_uom_id: v }))}</td>
                          <td className="border-l border-border px-1 py-1.5 text-center text-muted-foreground">=</td>
                          <td className="border-l border-border px-2 py-1.5">
                            <Input type="number" step="0.0001" value={c.base_qty} onChange={(e) => setConv(c.key, { base_qty: e.target.value })} className="text-base md:text-sm" />
                          </td>
                          <td className="px-2 py-1.5">{uomSelect(c.base_uom_id, (v) => setConv(c.key, { base_uom_id: v }))}</td>
                          <td className="border-l border-border px-1 py-1.5 text-center">
                            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => delConv(c.key)} aria-label="Remove conversion">
                              ✕
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* narrow-container stacked cards */}
                <div className="space-y-2 @lg:hidden">
                  {conversions.map((c, i) => (
                    <div key={c.key} className="space-y-2 rounded-lg border border-border p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => delConv(c.key)}>
                          ✕
                        </Button>
                      </div>
                      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                        <Input type="number" step="0.0001" placeholder="Alt qty" value={c.alt_qty} onChange={(e) => setConv(c.key, { alt_qty: e.target.value })} className="text-base md:text-sm" />
                        {uomSelect(c.alt_uom_id, (v) => setConv(c.key, { alt_uom_id: v }))}
                      </div>
                      <div className="grid grid-cols-[1fr_1.4fr] items-center gap-2">
                        <Input type="number" step="0.0001" placeholder="Base qty" value={c.base_qty} onChange={(e) => setConv(c.key, { base_qty: e.target.value })} className="text-base md:text-sm" />
                        {uomSelect(c.base_uom_id, (v) => setConv(c.key, { base_uom_id: v }))}
                      </div>
                    </div>
                  ))}
                </div>

                <Button type="button" variant="outline" size="sm" onClick={addConv}>
                  + Add conversion
                </Button>
              </div>

              {/* alternate uoms */}
              <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <Label>Stock Uom</Label>
                  {uomSelect(form.stock_uom_id, (v) => set({ stock_uom_id: v }))}
                </div>
                <div>
                  <Label>Billing Uom</Label>
                  {uomSelect(form.billing_uom_id, (v) => set({ billing_uom_id: v }))}
                </div>
                <div>
                  <Label>Planning Uom</Label>
                  {uomSelect(form.planning_uom_id, (v) => set({ planning_uom_id: v }))}
                </div>
                <div>
                  <Label>Purchase Uom</Label>
                  {uomSelect(form.purchase_uom_id, (v) => set({ purchase_uom_id: v }))}
                </div>
              </div>

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
          )}
        </div>
      </Sheet>
    </div>
  );
}
