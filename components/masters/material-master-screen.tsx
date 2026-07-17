"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
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
import type { ConfigLookup } from "@/lib/masters/extras-types";
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
  ply: "",
  direct_purchase: false,
  base_uom_id: "",
  stock_uom_id: "",
  billing_uom_id: "",
  planning_uom_id: "",
  purchase_uom_id: "",
  cost_head_id: "",
  budget_rate: "",
  budget_rate_uom_id: "",
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
  const unitIdByCode = useMemo(() => new Map(units.map((u) => [u.code, u.id])), [units]);
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
  // Top-level handler (same shape as addMix/delMix below) so newKey()'s ref
  // read happens in a spot the compiler can prove is event-handler-only —
  // a handler nested inside the fabricDetails() render-helper trips the
  // react-hooks/refs check even though it's only ever invoked from onChange.
  function handleFabricTypeChange(structureId: string) {
    const code = structureId ? structureCodeById.get(structureId) ?? null : null;
    const { baseId, secondaryId } = structureUomHint(code);
    set({
      fabric_structure_id: structureId,
      ...(baseId && !form.base_uom_id ? { base_uom_id: baseId, stock_uom_id: baseId } : {}),
    });
    if (baseId && secondaryId && conversions.length === 0) {
      setConversions([{ key: newKey(), alt_qty: "", alt_uom_id: baseId, base_qty: "", base_uom_id: secondaryId }]);
    }
  }

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setMixings([]);
    setConversions([]);
    setUsingItems([]);
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
      ply: r.ply != null ? String(r.ply) : "",
      direct_purchase: r.direct_purchase,
      base_uom_id: r.base_uom_id ?? "",
      stock_uom_id: r.stock_uom_id ?? "",
      billing_uom_id: r.billing_uom_id ?? "",
      planning_uom_id: r.planning_uom_id ?? "",
      purchase_uom_id: r.purchase_uom_id ?? "",
      cost_head_id: r.cost_head_id ?? "",
      budget_rate: r.budget_rate != null ? String(r.budget_rate) : "",
      budget_rate_uom_id: r.budget_rate_uom_id ?? "",
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
        code: form.code.trim(),
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
        ply: numOrNull(form.ply),
        direct_purchase: form.direct_purchase,
        base_uom_id: form.base_uom_id || null,
        stock_uom_id: form.stock_uom_id || null,
        billing_uom_id: form.billing_uom_id || null,
        planning_uom_id: form.planning_uom_id || null,
        purchase_uom_id: form.purchase_uom_id || null,
        cost_head_id: form.cost_head_id || null,
        budget_rate: numOrNull(form.budget_rate),
        budget_rate_uom_id: form.budget_rate_uom_id || null,
        mixings: mixings.map((m) => ({
          sno: 0,
          description: m.description || null,
          shade: m.shade || null,
          uom_id: m.uom_id || null,
          component_item_id: m.component_item_id || null,
          count_id: m.count_id || null,
          blend_pct: numOrNull(m.blend_pct),
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
        success(res.inactive ? `"${r.name}" is in use — marked inactive instead of deleted, history preserved.` : `"${r.name}" deleted.`);
        router.refresh();
      } else error(res.error);
    });
  }

  const uomOptions = units.map((u) => (
    <option key={u.id} value={u.id}>
      {u.code} — {u.name}
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

  // Live auto-name preview (0279) — Yarn: Count + Category + Purity/Mixing%;
  // Fabric: Structure + Yarn(s) + %. Non-destructive: shown as a suggestion the
  // operator can apply, never silently overwrites what they've typed.
  const suggestedName = useMemo(() => {
    if (formKey === "YARN") {
      const parts = [
        form.count_id ? countLabel.get(form.count_id) : null,
        selectedCategory?.made ?? null,
        form.purity_id ? purityLabel.get(form.purity_id) : null,
      ].filter(Boolean);
      if (mixings.length && selectedCategory?.made === "Mixed") {
        parts.push(mixings.map((m) => `${m.blend_pct || "?"}% ${m.component_item_id ? yarnItemName.get(m.component_item_id) ?? "?" : m.description || "?"}`).join(" / "));
      }
      return parts.join(" ") || null;
    }
    if (formKey === "FABRIC") {
      const structureName = structureCode ? fabricStructures.find((s) => s.code === structureCode)?.name : null;
      const parts = [structureName, form.fabric_type_id ? fabricTypeLabel.get(form.fabric_type_id) : null].filter(Boolean);
      if (mixings.length) {
        parts.push(mixings.map((m) => `${m.blend_pct || "?"}% ${m.component_item_id ? yarnItemName.get(m.component_item_id) ?? "?" : m.description || "?"}`).join(" / "));
      }
      return parts.join(" ") || null;
    }
    return null;
  }, [formKey, form.count_id, form.purity_id, form.fabric_type_id, selectedCategory, mixings, countLabel, purityLabel, fabricTypeLabel, structureCode, fabricStructures, yarnItemName]);

  /** Shared blend/mixing grid — Fabric ("Using" Single/Multiple yarn, Decision 4)
   *  and Yarn (only when Category nature = Mixed, Decision 7). Each row links to
   *  a real Yarn `items` record where possible; % must sum to 100 to save.
   *
   *  `variant: "fabric"` renders the legacy "Attributes" table (# | Description
   *  | Mixing %) — Description still prefers a linked Yarn item, falling back
   *  to free text when none is picked, same as before, just without the Shade
   *  and UOM columns legacy doesn't show here. `variant: "yarn"` is unchanged
   *  (Component yarn/%, Shade, UOM) — no legacy screen confirms trimming it. */
  function mixingGrid(variant: "fabric" | "yarn" = "yarn") {
    const pctBadge = mixings.length > 0 && (
      <span className={cn("text-xs font-medium", Math.abs(mixPctSum - 100) < 0.01 ? "text-success" : "text-danger")}>
        {mixPctSum}% of 100%
      </span>
    );
    const compCell = (m: MixRow) => (
      <div className="space-y-1">
        <Select value={m.component_item_id} onChange={(e) => setMix(m.key, { component_item_id: e.target.value })} className="text-base md:text-sm">
          <option value="">— Component yarn —</option>
          {yarnItems.map((y) => (
            <option key={y.id} value={y.id}>
              {y.code} — {y.name}
            </option>
          ))}
        </Select>
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
      return (
        <ChildGrid<MixRow>
          label="Attributes"
          badge={pctBadge}
          rows={mixings}
          onAdd={addMix}
          onRemove={(m) => delMix(m.key)}
          columns={[
            { header: "Description", cell: compCell },
            {
              header: "Mixing %",
              align: "center",
              cell: (m) => (
                <Input type="number" step="0.01" placeholder="%" value={m.blend_pct} onChange={(e) => setMix(m.key, { blend_pct: e.target.value })} className="text-base md:text-sm" />
              ),
            },
          ]}
          renderMobileRow={(m) => (
            <>
              {compCell(m)}
              <Input type="number" step="0.01" placeholder="Mixing %" value={m.blend_pct} onChange={(e) => setMix(m.key, { blend_pct: e.target.value })} className="text-base md:text-sm" />
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
          { header: "Component / Description", cell: compCell },
          { header: "%", align: "center", cell: (m) => <Input type="number" step="0.01" placeholder="%" value={m.blend_pct} onChange={(e) => setMix(m.key, { blend_pct: e.target.value })} className="text-base md:text-sm" /> },
          { header: "Shade", cell: (m) => <Input placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} className="text-base md:text-sm" /> },
          { header: "Uom", cell: (m) => uomSelect(m.uom_id, (v) => setMix(m.key, { uom_id: v })) },
        ]}
        renderMobileRow={(m) => (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Select value={m.component_item_id} onChange={(e) => setMix(m.key, { component_item_id: e.target.value })} className="text-base md:text-sm">
                <option value="">— Component yarn —</option>
                {yarnItems.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.code} — {y.name}
                  </option>
                ))}
              </Select>
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
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} className="text-base md:text-sm" />
              {uomSelect(m.uom_id, (v) => setMix(m.key, { uom_id: v }))}
            </div>
          </>
        )}
      />
    );
  }

  /** Fabric Details (0301/0302) — legacy order Type → Structure → Fabric Type
   *  → Direct Purchase → Using → Attributes:
   *  - Type: Circular Knit/Flat Knit/Woven, a direct field on the material —
   *    drives UOM auto-derivation on change.
   *  - Structure: the specific knit/weave pattern (e.g. "1X1 FANCY RIB") —
   *    this is `category_id`, scoped to the Fabric item class same as every
   *    other class's Category, just labeled "Structure" here (confirmed
   *    against legacy + existing Fabric-scoped category data). NOT the same
   *    field as Type, despite both having lived under one picker briefly. */
  function fabricDetails() {
    return (
      <>
        <DetailSection label="Classification">
            <div>
              <Label>Type</Label>
              <LookupDialogPicker
                kind="fabric_structure"
                label=""
                options={fabricStructures}
                value={form.fabric_structure_id}
                onChange={handleFabricTypeChange}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                isSuperAdmin={perms.isSuperAdmin}
                adminOnly
              />
            </div>
            <CategoryPicker
              label="Structure"
              categories={scopedCategories}
              value={form.category_id}
              onChange={(v) => set({ category_id: v })}
              itemClassId={form.item_class_id}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
            <div>
              <Label>
                Fabric Type <span className="text-danger">*</span>
              </Label>
              <LookupDialogPicker
                kind="fabric_type"
                label=""
                options={fabricTypes}
                value={form.fabric_type_id}
                onChange={(v) => set({ fabric_type_id: v })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                isSuperAdmin={perms.isSuperAdmin}
                adminOnly
              />
              <p className="mt-1 text-xs text-muted-foreground">Solid, Yarn-dyed or Melange — determines the dyeing PO type.</p>
            </div>
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

  /** Yarn Details (0279) — Nature (categories.made) drives Purity vs Mixing. */
  function yarnDetails() {
    const nature = selectedCategory?.made ?? null;
    return (
      <>
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
        </DetailSection>
        {nature === "Mixed" ? (
          mixingGrid("yarn")
        ) : (
          <DetailSection label="Composition">
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
        )}
        <DetailSection label="Other">
            <LookupDialogPicker
              kind="yarn_type"
              label="Yarn Type"
              options={yarnTypes}
              value={form.yarn_type_id}
              onChange={(v) => set({ yarn_type_id: v })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
              isSuperAdmin={perms.isSuperAdmin}
              adminOnly
            />
            <div>
              <Label>Ply</Label>
              <Input type="number" min={1} step={1} value={form.ply} onChange={(e) => set({ ply: e.target.value })} className="text-base md:text-sm" />
            </div>
        </DetailSection>
        {usingItemsGrid()}
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
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
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
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code}</div>
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

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Material" : "New Material"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.code.trim() || (formKey === "FABRIC" && !form.fabric_type_id)}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* header: Item Class + HSN */}
          <LookupDialogPicker
            kind="item_class"
            label="Item Class"
            options={itemClasses}
            value={form.item_class_id}
            onChange={(v) => set({ item_class_id: v, category_id: "" })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
            isSuperAdmin={perms.isSuperAdmin}
          />
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
              {["GEN", "PACK", "SEW"].includes(selectedClassCode ?? "") && usingItemsGrid()}

              {/* Short Name + Name (common) */}
              <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="mt-short">
                    Short Name <span className="text-danger">*</span>
                  </Label>
                  <Input id="mt-short" value={form.code} onChange={(e) => set({ code: e.target.value })} className="text-base md:text-sm" />
                </div>
                <div>
                  <Label htmlFor="mt-name">Name</Label>
                  <Input id="mt-name" value={form.name} onChange={(e) => set({ name: e.target.value })} className="text-base md:text-sm" />
                </div>
              </div>
              {suggestedName && suggestedName !== form.name && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
                  <span className="truncate text-xs text-muted-foreground">
                    Suggested: <span className="text-foreground">{suggestedName}</span>
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ name: suggestedName })}>
                    Use
                  </Button>
                </div>
              )}
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

              {/* Budget section removed from the UOM tab (client walkthrough, 0279) —
                  existing budget_rate/cost_head data is preserved on save, just no
                  longer editable here. */}

              <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-3">
                <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => set({ inactive: e.target.checked })} />
                <span className="text-sm text-foreground">Inactive</span>
              </label>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
