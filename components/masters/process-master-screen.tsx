"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createProcess, updateProcess, deleteProcess } from "@/lib/masters/process-actions";
import { BILLING_ON, type BillingOn, type Process, type ProcessInput } from "@/lib/masters/process-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type SubRow = { key: string; sub_category: string; short_description: string; hsn_code: string };

const BLANK = {
  name: "",
  short_description: "",
  commodity_id: "",
  billing_on: "" as "" | BillingOn,
  hsn_code: "",
  for_yarn: false,
  for_fabric: false,
  for_trims: false,
  for_garments: false,
  for_components: false,
  no_planning: false,
  designwise_delivery: false,
  is_conversion: false,
  has_sub_categories: false,
  blocked: false,
};

const FOR_FLAGS: { key: keyof typeof BLANK; label: string }[] = [
  { key: "for_yarn", label: "Yarn" },
  { key: "for_fabric", label: "Fabric" },
  { key: "for_trims", label: "Trims" },
  { key: "for_garments", label: "Garments" },
  { key: "for_components", label: "Components" },
];

/**
 * Master-detail CRUD for the legacy "Process" master: a header (name, commodity,
 * billing basis, "For" applicability + planning flags) plus an optional
 * "Sub Categories" line grid. Table on desktop, cards on mobile, Sheet editor.
 */
export function ProcessMasterScreen({
  rows,
  commodities,
  perms,
}: {
  rows: Process[];
  commodities: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `s${keySeq.current++}`;

  const commodityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of commodities) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [commodities]);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.short_description, r.billing_on, r.hsn_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setSubs([]);
    setOpen(true);
  }
  function openEdit(r: Process) {
    setEditId(r.id);
    setForm({
      name: r.name,
      short_description: r.short_description ?? "",
      commodity_id: r.commodity_id ?? "",
      billing_on: r.billing_on ?? "",
      hsn_code: r.hsn_code ?? "",
      for_yarn: r.for_yarn,
      for_fabric: r.for_fabric,
      for_trims: r.for_trims,
      for_garments: r.for_garments,
      for_components: r.for_components,
      no_planning: r.no_planning,
      designwise_delivery: r.designwise_delivery,
      is_conversion: r.is_conversion,
      has_sub_categories: r.has_sub_categories,
      blocked: r.blocked,
    });
    setSubs(
      r.sub_categories.map((c) => ({
        key: newKey(),
        sub_category: c.sub_category,
        short_description: c.short_description ?? "",
        hsn_code: c.hsn_code ?? "",
      })),
    );
    setOpen(true);
  }

  function toggleHasSubs(checked: boolean) {
    set({ has_sub_categories: checked });
    if (checked && subs.length === 0)
      setSubs([{ key: newKey(), sub_category: "", short_description: "", hsn_code: "" }]);
  }
  function addSub() {
    setSubs((ss) => [...ss, { key: newKey(), sub_category: "", short_description: "", hsn_code: "" }]);
  }
  function setSubAt(key: string, patch: Partial<SubRow>) {
    setSubs((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function removeSub(key: string) {
    setSubs((ss) => ss.filter((s) => s.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ProcessInput = {
        name: form.name.trim(),
        short_description: form.short_description.trim() || null,
        commodity_id: form.commodity_id || null,
        billing_on: form.billing_on ? form.billing_on : null,
        hsn_code: form.hsn_code.trim() || null,
        for_yarn: form.for_yarn,
        for_fabric: form.for_fabric,
        for_trims: form.for_trims,
        for_garments: form.for_garments,
        for_components: form.for_components,
        no_planning: form.no_planning,
        designwise_delivery: form.designwise_delivery,
        is_conversion: form.is_conversion,
        has_sub_categories: form.has_sub_categories,
        blocked: form.blocked,
        sub_categories: form.has_sub_categories
          ? subs
              .filter((s) => s.sub_category.trim())
              .map((s, i) => ({
                sno: i + 1,
                sub_category: s.sub_category.trim(),
                short_description: s.short_description.trim() || null,
                hsn_code: s.hsn_code.trim() || null,
              }))
          : [],
      };
      const res = editId ? await updateProcess(editId, payload) : await createProcess(payload);
      if (res.ok) {
        success(editId ? "Process updated." : "Process added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Process) {
    startTransition(async () => {
      const res = await deleteProcess(r.id);
      if (res.ok) {
        success("Process deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function forSummary(r: Process): string {
    const on = FOR_FLAGS.filter((f) => r[f.key as keyof Process]).map((f) => f.label);
    return on.length ? on.join(", ") : "—";
  }

  const columns: Column<Process>[] = [
    { header: "Process", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Billing On",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.billing_on ?? "—"}</span>,
    },
    { header: "For", cell: (r) => <span className="text-sm text-muted-foreground">{forSummary(r)}</span> },
    {
      header: "Sub-cats",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.has_sub_categories ? r.sub_categories.length : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>
          {r.blocked ? "Blocked" : "Active"}
        </StatusPill>
      ),
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
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search process…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Process
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No process records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No process records yet.
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.billing_on ?? "—"} · For: {forSummary(r)}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Process" : "New Process"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="pr-name">
              Process <span className="text-danger">*</span>
            </Label>
            <Input
              id="pr-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pr-desc">Short Description</Label>
            <Input
              id="pr-desc"
              value={form.short_description}
              onChange={(e) => set({ short_description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pr-commodity">Commodity</Label>
            <Select
              id="pr-commodity"
              value={form.commodity_id}
              onChange={(e) => set({ commodity_id: e.target.value })}
              className="text-base md:text-sm"
            >
              <option value="">— None —</option>
              {commodities.map((c) => (
                <option key={c.id} value={c.id}>
                  {commodityLabel.get(c.id)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pr-billing">Billing On</Label>
              <Select
                id="pr-billing"
                value={form.billing_on}
                onChange={(e) => set({ billing_on: e.target.value as "" | BillingOn })}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {BILLING_ON.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pr-hsn">HSN Code</Label>
              <Input
                id="pr-hsn"
                value={form.hsn_code}
                onChange={(e) => set({ hsn_code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>

          {/* For */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              For
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FOR_FLAGS.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form[f.key] as boolean}
                    onChange={(e) => set({ [f.key]: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Planning flags */}
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.no_planning}
                onChange={(e) => set({ no_planning: e.target.checked })}
              />
              <span className="text-sm text-foreground">Doesn&apos;t require planning for Receipt / Delivery</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.designwise_delivery}
                onChange={(e) => set({ designwise_delivery: e.target.checked })}
              />
              <span className="text-sm text-foreground">Requires Designwise Delivery</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_conversion}
                onChange={(e) => set({ is_conversion: e.target.checked })}
              />
              <span className="text-sm text-foreground">Is Conversion Process</span>
            </label>
          </div>

          {/* Sub Categories */}
          <div className="rounded-lg border border-border">
            <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.has_sub_categories}
                onChange={(e) => toggleHasSubs(e.target.checked)}
              />
              <span className="text-sm font-medium text-foreground">Has Sub Categories</span>
            </label>
            {form.has_sub_categories && (
              <div className="space-y-3 p-3">
                {subs.length === 0 && <p className="text-xs text-muted-foreground">No sub categories yet.</p>}
                {subs.map((s, i) => (
                  <div key={s.key} className="space-y-2 rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-danger"
                        onClick={() => removeSub(s.key)}
                        aria-label="Remove sub category"
                      >
                        ✕
                      </Button>
                    </div>
                    <Input
                      value={s.sub_category}
                      onChange={(e) => setSubAt(s.key, { sub_category: e.target.value })}
                      placeholder="Sub Category"
                      className="text-base md:text-sm"
                    />
                    <Input
                      value={s.short_description}
                      onChange={(e) => setSubAt(s.key, { short_description: e.target.value })}
                      placeholder="Short Description"
                      className="text-base md:text-sm"
                    />
                    <Input
                      value={s.hsn_code}
                      onChange={(e) => setSubAt(s.key, { hsn_code: e.target.value })}
                      placeholder="HSN Code"
                      className="text-base md:text-sm"
                    />
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addSub}>
                  + Add sub category
                </Button>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => set({ blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
