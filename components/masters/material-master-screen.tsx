"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createMaterial, updateMaterial, deleteMaterial } from "@/lib/masters/material-actions";
import { createItemClass } from "@/lib/masters/category-actions";
import { LookupPicker } from "@/components/masters/lookup-picker";
import {
  MATERIAL_FORMS,
  MATERIAL_TYPES,
  itemClassForm,
  type Material,
  type MaterialInput,
  type DetailFieldKey,
} from "@/lib/masters/material-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";
import type { Uom } from "@/lib/masters/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type CostHead = { id: string; name: string };
type MixRow = { key: string; description: string; shade: string; uom_id: string };
type ConvRow = { key: string; alt_qty: string; alt_uom_id: string; base_qty: string; base_uom_id: string };

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
  base_uom_id: "",
  stock_uom_id: "",
  billing_uom_id: "",
  planning_uom_id: "",
  purchase_uom_id: "",
  cost_head_id: "",
  budget_rate: "",
  budget_rate_uom_id: "",
  blocked: false,
};
type Form = typeof BLANK;

export function MaterialMasterScreen({
  rows,
  itemClasses,
  categories,
  counts,
  purities,
  hsnCodes,
  units,
  costHeads,
  perms,
}: {
  rows: Material[];
  itemClasses: ConfigLookup[];
  categories: Category[];
  counts: ConfigLookup[];
  purities: ConfigLookup[];
  hsnCodes: ConfigLookup[];
  units: Uom[];
  costHeads: CostHead[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [section, setSection] = useState<"details" | "uom">("details");
  const [form, setForm] = useState<Form>(BLANK);
  const [mixings, setMixings] = useState<MixRow[]>([]);
  const [conversions, setConversions] = useState<ConvRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `r${keySeq.current++}`;

  // inline item-class add
  const [extraClasses, setExtraClasses] = useState<ConfigLookup[]>([]);
  const [showNewClass, setShowNewClass] = useState(false);
  const [newClassCode, setNewClassCode] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const allClasses = useMemo(() => {
    const seen = new Set<string>();
    return [...itemClasses, ...extraClasses].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [itemClasses, extraClasses]);

  const classLabel = useMemo(() => new Map(allClasses.map((c) => [c.id, c.name])), [allClasses]);
  const catLabel = useMemo(() => new Map(categories.map((c) => [c.id, c.name ?? "—"])), [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, classLabel.get(r.item_class_id ?? ""), r.hsn_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, classLabel]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const selectedClassCode = allClasses.find((c) => c.id === form.item_class_id)?.code ?? null;
  const formDef = MATERIAL_FORMS[itemClassForm(selectedClassCode)];

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setMixings([]);
    setConversions([]);
    setSection("details");
    setShowNewClass(false);
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
      base_uom_id: r.base_uom_id ?? "",
      stock_uom_id: r.stock_uom_id ?? "",
      billing_uom_id: r.billing_uom_id ?? "",
      planning_uom_id: r.planning_uom_id ?? "",
      purchase_uom_id: r.purchase_uom_id ?? "",
      cost_head_id: r.cost_head_id ?? "",
      budget_rate: r.budget_rate != null ? String(r.budget_rate) : "",
      budget_rate_uom_id: r.budget_rate_uom_id ?? "",
      blocked: !r.is_active,
    });
    setMixings(
      r.mixings.map((m) => ({
        key: newKey(),
        description: m.description ?? "",
        shade: m.shade ?? "",
        uom_id: m.uom_id ?? "",
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
    setSection("details");
    setShowNewClass(false);
    setOpen(true);
  }

  function addItemClass() {
    startTransition(async () => {
      const res = await createItemClass({ code: newClassCode.trim() || null, name: newClassName });
      if (res.ok) {
        setExtraClasses((xs) => [
          ...xs,
          { id: res.id, kind: "item_class", code: newClassCode.trim() || null, name: newClassName.trim(), notes: null, is_active: true, created_at: "", updated_at: "" },
        ]);
        set({ item_class_id: res.id });
        setShowNewClass(false);
        setNewClassCode("");
        setNewClassName("");
        success("Item Class added.");
        router.refresh();
      } else error(res.error);
    });
  }

  // grid mutators
  const addMix = () => setMixings((xs) => [...xs, { key: newKey(), description: "", shade: "", uom_id: "" }]);
  const setMix = (key: string, patch: Partial<MixRow>) => setMixings((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delMix = (key: string) => setMixings((xs) => xs.filter((r) => r.key !== key));
  const addConv = () => setConversions((xs) => [...xs, { key: newKey(), alt_qty: "", alt_uom_id: "", base_qty: "", base_uom_id: "" }]);
  const setConv = (key: string, patch: Partial<ConvRow>) => setConversions((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delConv = (key: string) => setConversions((xs) => xs.filter((r) => r.key !== key));

  function submit() {
    startTransition(async () => {
      const payload: MaterialInput = {
        code: form.code.trim(),
        name: form.name.trim() || null,
        is_active: !form.blocked,
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
        base_uom_id: form.base_uom_id || null,
        stock_uom_id: form.stock_uom_id || null,
        billing_uom_id: form.billing_uom_id || null,
        planning_uom_id: form.planning_uom_id || null,
        purchase_uom_id: form.purchase_uom_id || null,
        cost_head_id: form.cost_head_id || null,
        budget_rate: numOrNull(form.budget_rate),
        budget_rate_uom_id: form.budget_rate_uom_id || null,
        mixings: mixings.map((m) => ({ sno: 0, description: m.description || null, shade: m.shade || null, uom_id: m.uom_id || null })),
        conversions: conversions.map((c) => ({
          sno: 0,
          alt_qty: numOrNull(c.alt_qty),
          alt_uom_id: c.alt_uom_id || null,
          base_qty: numOrNull(c.base_qty),
          base_uom_id: c.base_uom_id || null,
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
        success("Material deleted.");
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
          <div key={key}>
            <Label>Category</Label>
            <Select value={form.category_id} onChange={(e) => set({ category_id: e.target.value })} className="text-base md:text-sm">
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.short_name ?? "—"}
                </option>
              ))}
            </Select>
          </div>
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
          <LookupPicker
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
          <LookupPicker
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

  const columns: Column<Material>[] = [
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Category",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.category_id ? catLabel.get(r.category_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Blocked"}</StatusPill>,
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
          {perms.canDelete && (
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" disabled={isPending} onClick={() => remove(r)}>
              Delete
            </Button>
          )}
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
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search materials…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Material
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No materials yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No materials yet.
          </div>
        ) : (
          filtered.map((r) => (
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
                <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Blocked"}</StatusPill>
              </div>
              {r.item_class_id && <div className="mt-2 text-[13px] text-muted-foreground">{classLabel.get(r.item_class_id)}</div>}
            </button>
          ))
        )}
      </div>

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
            <Button size="md" disabled={isPending || !form.code.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* header: Item Class + HSN */}
          <div>
            <Label htmlFor="mt-class">Item Class</Label>
            <div className="flex gap-2">
              <Select id="mt-class" value={form.item_class_id} onChange={(e) => set({ item_class_id: e.target.value })} className="flex-1 text-base md:text-sm">
                <option value="">— Select —</option>
                {allClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} — ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
              {perms.canCreate && (
                <Button type="button" variant="outline" size="md" onClick={() => setShowNewClass((v) => !v)}>
                  {showNewClass ? "Cancel" : "+ New"}
                </Button>
              )}
            </div>
            {showNewClass && (
              <div className="mt-2 flex items-end gap-2 rounded-lg border border-border p-2.5">
                <div className="w-24">
                  <Label htmlFor="mt-class-code">Code</Label>
                  <Input id="mt-class-code" value={newClassCode} onChange={(e) => setNewClassCode(e.target.value)} className="text-base md:text-sm" />
                </div>
                <div className="flex-1">
                  <Label htmlFor="mt-class-name">Name</Label>
                  <Input id="mt-class-name" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} className="text-base md:text-sm" />
                </div>
                <Button type="button" size="md" disabled={isPending || !newClassName.trim()} onClick={addItemClass}>
                  Add
                </Button>
              </div>
            )}
          </div>
          <LookupPicker
            kind="hsn_code"
            label="HSN Code"
            options={hsnCodes}
            value={form.hsn_id}
            onChange={(v) => set({ hsn_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
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
              ) : (
                formDef.fields.map((k) => detailField(k))
              )}

              {/* Mixing grid (Form B) */}
              {formDef.mixing && (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mixing</div>
                  {mixings.map((m, i) => (
                    <div key={m.key} className="space-y-2 rounded-lg border border-border p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => delMix(m.key)}>
                          ✕
                        </Button>
                      </div>
                      <Input placeholder="Description" value={m.description} onChange={(e) => setMix(m.key, { description: e.target.value })} className="text-base md:text-sm" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="Shade" value={m.shade} onChange={(e) => setMix(m.key, { shade: e.target.value })} className="text-base md:text-sm" />
                        {uomSelect(m.uom_id, (v) => setMix(m.key, { uom_id: v }))}
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addMix}>
                    + Add mixing row
                  </Button>
                </div>
              )}

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
            </div>
          )}

          {/* UOM section — common to all classes */}
          {section === "uom" && (
            <div className="space-y-4">
              <div>
                <Label>Base Uom</Label>
                {uomSelect(form.base_uom_id, (v) => set({ base_uom_id: v }))}
              </div>

              {/* conversion grid */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alternate ↔ Base conversions</div>
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

              {/* budget */}
              <div className="space-y-3 border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget</div>
                <div>
                  <Label>Cost Head</Label>
                  <Select value={form.cost_head_id} onChange={(e) => set({ cost_head_id: e.target.value })} className="text-base md:text-sm">
                    <option value="">— None —</option>
                    {costHeads.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                  <div>
                    <Label>Budget Rate</Label>
                    <Input type="number" step="0.0001" value={form.budget_rate} onChange={(e) => set({ budget_rate: e.target.value })} className="text-base md:text-sm" />
                  </div>
                  <div>
                    <Label>per</Label>
                    {uomSelect(form.budget_rate_uom_id, (v) => set({ budget_rate_uom_id: v }))}
                  </div>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-3">
                <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.blocked} onChange={(e) => set({ blocked: e.target.checked })} />
                <span className="text-sm text-foreground">Blocked (inactive)</span>
              </label>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
