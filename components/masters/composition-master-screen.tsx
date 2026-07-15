"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
import { fmtNumber } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createComposition,
  updateComposition,
  deleteComposition,
} from "@/lib/masters/composition-actions";
import { LookupDialogPicker } from "@/components/masters/lookup-picker";
import type { Composition, CompositionInput } from "@/lib/masters/composition-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type LineRow = { key: string; description: string; mixing_pct: string };

const BLANK = { item_class_id: "", short_name: "", name: "", inactive: false };

/**
 * Master-detail CRUD for the legacy "Composition" master: a header (Item Class
 * · Short Name · Name · Inactive) plus a "Mixing" grid of free-text fibre
 * descriptions + their mixing %. Composition only ever applies to Fabric, so
 * Item Class uses the same LookupDialogPicker as every other master (search +
 * Add/Modify/Delete), just fed a Fabric-only options list from page.tsx —
 * mirrors Material Attribute's PACK/SEW restriction, category.tsx's picker.
 * Dense table on desktop, cards on mobile, shared <Sheet> editor.
 */
export function CompositionMasterScreen({
  rows,
  itemClasses,
  perms,
}: {
  rows: Composition[];
  itemClasses: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const fabricClass = itemClasses[0];
  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.name, r.short_name, classLabel.get(r.item_class_id), ...r.lines.map((l) => l.description)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, item_class_id: fabricClass?.id ?? "" });
    setLines([{ key: newKey(), description: "", mixing_pct: "" }]);
    setOpen(true);
  }
  function openEdit(r: Composition) {
    setEditId(r.id);
    setForm({
      item_class_id: r.item_class_id,
      short_name: r.short_name ?? "",
      name: r.name ?? "",
      inactive: r.inactive,
    });
    setLines(
      r.lines.map((l) => ({ key: newKey(), description: l.description, mixing_pct: String(l.mixing_pct) })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, { key: newKey(), description: "", mixing_pct: "" }]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  const pctTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.mixing_pct) || 0), 0),
    [lines],
  );

  function submit() {
    startTransition(async () => {
      const payload: CompositionInput = {
        item_class_id: form.item_class_id,
        short_name: form.short_name.trim() || null,
        name: form.name.trim() || null,
        inactive: form.inactive,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l, i) => ({ sno: i + 1, description: l.description.trim(), mixing_pct: Number(l.mixing_pct) || 0 })),
      };
      const res = editId ? await updateComposition(editId, payload) : await createComposition(payload);
      if (res.ok) {
        success(editId ? "Composition updated." : "Composition added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Composition) {
    startTransition(async () => {
      const res = await deleteComposition(r.id);
      if (res.ok) {
        success("Composition deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Composition>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{classLabel.get(r.item_class_id) ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? r.short_name ?? "—"}</span> },
    {
      header: "Mixing",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.lines.length
            ? r.lines.map((l) => `${l.description} ${fmtNumber(l.mixing_pct)}%`).join(", ")
            : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
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
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search composition…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="composition-filter-status">Status</Label>
            <Select
              id="composition-filter-status"
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
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="compositions" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Composition
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No composition records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No composition records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.name ?? r.short_name ?? classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {r.lines.length > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.lines.map((l) => `${l.description} ${fmtNumber(l.mixing_pct)}%`).join(", ")}
                </div>
              )}
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
        title={editId ? "Edit Composition" : "New Composition"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.item_class_id} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Item Class — same LookupDialogPicker every master uses (search +
              inline Add/Modify/Delete). Composition only ever applies to
              Fabric, so `itemClasses` from page.tsx is already filtered to
              that single row — the dialog just naturally lists only Fabric. */}
          <LookupDialogPicker
            kind="item_class"
            label="Item Class"
            required
            options={itemClasses}
            value={form.item_class_id}
            onChange={(v) => setForm({ ...form, item_class_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
            isSuperAdmin={perms.isSuperAdmin}
          />

          <div>
            <Label htmlFor="cmp-short">Short Name</Label>
            <Input
              id="cmp-short"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cmp-name">Name</Label>
            <Input
              id="cmp-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          {/* Mixing grid */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">Mixing</span>
              <span
                className={`text-xs tabular-nums ${pctTotal === 100 ? "text-success" : "text-muted-foreground"}`}
              >
                Total {fmtNumber(pctTotal)}%
              </span>
            </div>
            <div className="space-y-2 p-3">
              {lines.length === 0 && <p className="text-xs text-muted-foreground">No mixing lines yet.</p>}
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    value={l.description}
                    onChange={(e) => setLineAt(l.key, { description: e.target.value })}
                    placeholder="Description"
                    className="flex-1 text-base md:text-sm"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.mixing_pct}
                    onChange={(e) => setLineAt(l.key, { mixing_pct: e.target.value })}
                    placeholder="%"
                    className="w-20 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)}
                    aria-label="Remove line"
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add line
              </Button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
