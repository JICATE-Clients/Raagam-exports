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
  createProcessSequence,
  updateProcessSequence,
  deleteProcessSequence,
} from "@/lib/masters/grid-master-actions";
import type { ProcessSequence, ProcessSequenceInput } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

type LineRow = { key: string; description: string; loss_pct: string; rate: string };
const blankLine = (key: string): LineRow => ({ key, description: "", loss_pct: "", rate: "" });

export function ProcessSequenceMasterScreen({ rows, perms }: { rows: ProcessSequence[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", item_class_type: "", inactive: false });
  const [lines, setLines] = useState<LineRow[]>([]);
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
    setForm({ code: "", name: "", item_class_type: "", inactive: false });
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: ProcessSequence) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, item_class_type: r.item_class_type ?? "", inactive: !r.is_active });
    setLines(r.details.slice().sort((a, b) => a.sno - b.sno).map((d) => ({
      key: newKey(),
      description: d.description ?? "",
      loss_pct: d.loss_pct != null ? String(d.loss_pct) : "",
      rate: d.rate != null ? String(d.rate) : "",
    })));
    setOpen(true);
  }

  function addLine() { setLines((ls) => [...ls, blankLine(newKey())]); }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  function submit() {
    startTransition(async () => {
      const payload: ProcessSequenceInput = {
        code: form.code.trim(),
        name: form.name.trim() || form.code.trim(),
        item_class_type: form.item_class_type.trim(),
        is_active: !form.inactive,
        details: lines.map((l, i) => ({
          sno: i + 1,
          stage: null,
          process_id: null,
          process_group: null,
          loss_pct: numOrNull(l.loss_pct) ?? 0,
          loss_for: "P",
          rate: numOrNull(l.rate) ?? 0,
          expected_loss_pct: 0,
          vendor_id: null,
          description: l.description.trim() || null,
        })),
      };
      const res = editId ? await updateProcessSequence(editId, payload) : await createProcessSequence(payload);
      if (res.ok) {
        success(editId ? "Process sequence updated." : "Process sequence added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ProcessSequence) {
    startTransition(async () => {
      const res = await deleteProcessSequence(r.id);
      if (res.ok) {
        success(res.inactive ? "Process sequence marked inactive." : "Process sequence deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ProcessSequence>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Steps", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
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
          searchPlaceholder="Search process sequence..."
          activeCount={activeCount}
          onReset={() => { reset(); pg.setPage(1); }}
        >
          <div>
            <Label htmlFor="ps-filter-status">Status</Label>
            <Select id="ps-filter-status" value={filterValues.status}
              onChange={(e) => { setFilter("status", e.target.value); pg.setPage(1); }}
              className="text-base md:text-sm">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="process-sequences" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Process Sequence</Button>}
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No process sequence records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No process sequence records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code} · {r.details.length} step{r.details.length === 1 ? "" : "s"}</div>
              </div>
              <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? "Edit Process Sequence" : "New Process Sequence"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !form.code.trim() || lines.length === 0} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ps-code">Code <span className="text-danger">*</span></Label>
              <Input id="ps-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="ps-name">Name</Label>
              <Input id="ps-name" value={form.name} placeholder={form.code || undefined} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-base md:text-sm" />
            </div>
          </div>
          <div>
            <Label htmlFor="ps-ict">Item Class Type <span className="text-danger">*</span></Label>
            <Input id="ps-ict" value={form.item_class_type} onChange={(e) => setForm({ ...form, item_class_type: e.target.value })} className="text-base md:text-sm" />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => setForm({ ...form, inactive: e.target.checked })} />
            <span className="text-sm text-foreground">Inactive</span>
          </label>

          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Steps</div>
            <div className="space-y-2 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <Input placeholder="Description" value={l.description}
                    onChange={(e) => setLineAt(l.key, { description: e.target.value })}
                    className="flex-1 text-base md:text-sm" />
                  <Input type="number" placeholder="Loss %" value={l.loss_pct} min={0} max={100}
                    onChange={(e) => setLineAt(l.key, { loss_pct: e.target.value })}
                    className="w-20 text-base md:text-sm" />
                  <Input type="number" placeholder="Rate" value={l.rate} min={0} step="0.01"
                    onChange={(e) => setLineAt(l.key, { rate: e.target.value })}
                    className="w-20 text-base md:text-sm" />
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Step</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
