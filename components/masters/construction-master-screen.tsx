"use client";

import { useRef, useState, useTransition } from "react";
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
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  createConstruction,
  updateConstruction,
  deleteConstruction,
} from "@/lib/masters/grid-master-actions";
import type { Construction, ConstructionInput } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const CONSTRUCT_FOR_OPTIONS = [
  { value: "G", label: "Grey" },
  { value: "F", label: "Finished" },
];

type LookupOption = { id: string; code: string; name: string };

type CountLine = { key: string; count_type: "P" | "T"; count_lookup_id: string | null; item_id: string | null };
const blankCountLine = (key: string): CountLine => ({ key, count_type: "P", count_lookup_id: null, item_id: null });

const BLANK = {
  code: "", name: "", reed: "", epi_on_loom: "", reed_count: "", pick: "",
  construct_for: "G", weave_tech_desc: "", is_direct_purchase: false, inactive: false,
};

export function ConstructionMasterScreen({ rows, counts, items, perms }: { rows: Construction[]; counts: LookupOption[]; items: LookupOption[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [lines, setLines] = useState<CountLine[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) => [r.code, r.name].join(" ").toLowerCase().includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
      },
      initialFilters: { status: "" },
    },
  );
  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setLines([]);
    setOpen(true);
  }
  function openEdit(r: Construction) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      reed: r.reed != null ? String(r.reed) : "",
      epi_on_loom: r.epi_on_loom != null ? String(r.epi_on_loom) : "",
      reed_count: r.reed_count ?? "",
      pick: r.pick != null ? String(r.pick) : "",
      construct_for: r.construct_for ?? "G",
      weave_tech_desc: r.weave_tech_desc ?? "",
      is_direct_purchase: r.is_direct_purchase ?? false,
      inactive: !r.is_active,
    });
    setLines(
      (r.details ?? []).slice().sort((a, b) => a.sno - b.sno).map((d) => ({
        key: newKey(),
        count_type: d.count_type,
        count_lookup_id: d.count_lookup_id,
        item_id: d.item_id,
      })),
    );
    setOpen(true);
  }

  function addLine() { setLines((ls) => [...ls, blankCountLine(newKey())]); }
  function setLineAt(key: string, patch: Partial<CountLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  const numOrZero = (v: string) => (v.trim() === "" ? 0 : Number(v));

  function submit() {
    startTransition(async () => {
      const payload: ConstructionInput = {
        code: form.code.trim(),
        name: form.name.trim() || form.code.trim(),
        reed: numOrZero(form.reed),
        epi_on_loom: numOrZero(form.epi_on_loom),
        reed_count: form.reed_count.trim() || null,
        pick: numOrZero(form.pick),
        construct_for: form.construct_for,
        weave_tech_desc: form.weave_tech_desc.trim() || null,
        category_id: null,
        is_direct_purchase: form.is_direct_purchase,
        is_active: !form.inactive,
        details: lines.map((l, i) => ({
          sno: i + 1,
          count_type: l.count_type,
          count_lookup_id: l.count_lookup_id,
          item_id: l.item_id,
        })),
      };
      const res = editId ? await updateConstruction(editId, payload) : await createConstruction(payload);
      if (res.ok) {
        success(editId ? "Construction updated." : "Construction added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Construction) {
    startTransition(async () => {
      const res = await deleteConstruction(r.id);
      if (res.ok) {
        success(res.inactive ? "Construction marked inactive." : "Construction deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const warpCount = (r: Construction) => (r.details ?? []).filter((d) => d.count_type === "P").length;
  const weftCount = (r: Construction) => (r.details ?? []).filter((d) => d.count_type === "T").length;

  const columns: Column<Construction>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Reed", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.reed ?? "—"}</span> },
    { header: "EPI", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.epi_on_loom ?? "—"}</span> },
    { header: "Pick", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.pick ?? "—"}</span> },
    { header: "Warp/Weft", align: "right", cell: (r) => <span className="tabular-nums text-sm">{warpCount(r)}P / {weftCount(r)}T</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => { setQuery(v); pg.setPage(1); }}
          searchPlaceholder="Search construction..."
          activeCount={activeCount}
          onReset={() => { reset(); pg.setPage(1); }}
        >
          <div>
            <Label htmlFor="con-filter-status">Status</Label>
            <Select id="con-filter-status" value={filterValues.status}
              onChange={(e) => { setFilter("status", e.target.value); pg.setPage(1); }}
              className="text-base md:text-sm">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="constructions" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Construction</Button>}
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No construction records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No construction records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code} · Reed {r.reed} · Pick {r.pick}</div>
              </div>
              <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? "Edit Construction" : "New Construction"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !form.code.trim()} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="con-code">Code <span className="text-danger">*</span></Label>
              <Input id="con-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="con-name">Name</Label>
              <Input id="con-name" value={form.name} placeholder={form.code || undefined} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-base md:text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="con-reed">Reed</Label>
              <Input id="con-reed" type="number" min={0} value={form.reed} onChange={(e) => setForm({ ...form, reed: e.target.value })} className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="con-epi">EPI on Loom</Label>
              <Input id="con-epi" type="number" min={0} value={form.epi_on_loom} onChange={(e) => setForm({ ...form, epi_on_loom: e.target.value })} className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="con-reedcount">Reed Count</Label>
              <Input id="con-reedcount" value={form.reed_count} onChange={(e) => setForm({ ...form, reed_count: e.target.value })} className="text-base md:text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="con-pick">Pick</Label>
              <Input id="con-pick" type="number" min={0} step="0.01" value={form.pick} onChange={(e) => setForm({ ...form, pick: e.target.value })} className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="con-for">Construct For</Label>
              <Select id="con-for" value={form.construct_for}
                onChange={(e) => setForm({ ...form, construct_for: e.target.value })}
                className="text-base md:text-sm">
                {CONSTRUCT_FOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="con-desc">Weave Tech Description</Label>
            <Input id="con-desc" value={form.weave_tech_desc} onChange={(e) => setForm({ ...form, weave_tech_desc: e.target.value })} className="text-base md:text-sm" />
          </div>
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.is_direct_purchase} onChange={(e) => setForm({ ...form, is_direct_purchase: e.target.checked })} />
              <span className="text-sm text-foreground">Direct Purchase</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => setForm({ ...form, inactive: e.target.checked })} />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          </div>

          {/* Warp/Weft Counts child grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Warp &amp; Weft Counts</div>
            <div className="space-y-2 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <Select value={l.count_type}
                    onChange={(e) => setLineAt(l.key, { count_type: e.target.value as "P" | "T" })}
                    className="w-28 text-base md:text-sm">
                    <option value="P">Warp (P)</option>
                    <option value="T">Weft (T)</option>
                  </Select>
                  <Select value={l.count_lookup_id ?? ""}
                    onChange={(e) => setLineAt(l.key, { count_lookup_id: e.target.value || null })}
                    className="flex-1 text-base md:text-sm">
                    <option value="">— count —</option>
                    {counts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                  <Select value={l.item_id ?? ""}
                    onChange={(e) => setLineAt(l.key, { item_id: e.target.value || null })}
                    className="flex-1 text-base md:text-sm">
                    <option value="">— yarn item —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>{it.code} — {it.name}</option>
                    ))}
                  </Select>
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Count</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
