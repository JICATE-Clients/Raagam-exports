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
import { ChildGrid } from "@/components/masters/child-grid";
import { saveAttributeValues } from "@/lib/masters/extras-actions";
import { type Attribute } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };
// An attribute value is just a NAME now — its numeric/option behaviour and value
// list are configured per-category in the Material Attribute screen (0346), not
// here. Type/Options columns were removed (client 2026-07-25).
type ValueRow = { key: string; value: string };

/**
 * Attribute master (doc/update.md #2-3) — the second half of the Item Class /
 * Attribute split. Lists every Item Class; for a class flagged Has Attribute =
 * Yes it shows the value-adding grid (e.g. GSM 180/200), for No it shows the
 * class with no value section. Item Class lifecycle (create / rename / block)
 * lives on the Item Class screen — here you only edit the per-class value list.
 */
export function AttributeMasterScreen({ rows, perms }: { rows: Attribute[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<Attribute | null>(null);
  const [values, setValues] = useState<ValueRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `v${keySeq.current++}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      searchKey: (r) => [r.code, r.name, ...r.values.map((v) => v.value)].filter(Boolean).join(" "),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
        attr: (r, v) => (v === "yes" ? !!r.has_attribute : v === "no" ? !r.has_attribute : true),
      },
      initialFilters: { status: "", attr: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  function openEdit(r: Attribute) {
    setEditRow(r);
    setValues(r.values.map((v) => ({ key: newKey(), value: v.value })));
    setOpen(true);
  }
  function addValueRow() {
    // ChildGrid (pageSize) handles jumping to the new last page on add.
    setValues((vs) => [...vs, { key: newKey(), value: "" }]);
  }
  function setValueAt(key: string, value: string) {
    setValues((vs) => vs.map((v) => (v.key === key ? { ...v, value } : v)));
  }
  function removeValueRow(key: string) {
    setValues((vs) => vs.filter((v) => v.key !== key));
  }

  function submit() {
    if (!editRow) return;
    startTransition(async () => {
      // Names only, stored in CAPS (masters convention) — input_type/options
      // default server-side (unused by the flow).
      const payload = values
        .filter((v) => v.value.trim())
        .map((v) => ({ value: v.value.trim().toUpperCase() }));
      const res = await saveAttributeValues(editRow.id, payload);
      if (res.ok) {
        success("Attributes saved.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Attribute>[] = [
    { header: "Item Class", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "Has Attribute",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.has_attribute ? "Yes" : "No"}</span>,
    },
    {
      header: "Attributes",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">{r.values.length || "—"}</span>
      ),
    },
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
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              {r.has_attribute ? "Edit attributes" : "View"}
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
          searchPlaceholder="Search item class / attribute…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="at-filter-status">Status</Label>
            <Select
              id="at-filter-status"
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
            <Label htmlFor="at-filter-attr">Has Attribute</Label>
            <Select
              id="at-filter-attr"
              value={filterValues.attr}
              onChange={(e) => {
                setFilter("attr", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="attributes" rows={filtered} canExport={perms.canExport} />
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No item classes yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No item classes yet.
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Has Attribute: {r.has_attribute ? "Yes" : "No"}
                    {r.has_attribute && r.values.length > 0 ? ` · ${r.values.length} value${r.values.length === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.is_active ? "success" : "danger"}>
                  {r.is_active ? "Active" : "Inactive"}
                </StatusPill>
              </div>
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
        title={editRow ? `Attributes — ${editRow.name}` : "Attributes"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              {editRow?.has_attribute ? "Cancel" : "Close"}
            </Button>
            {editRow?.has_attribute && (
              <Button size="md" disabled={isPending} onClick={submit}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {editRow && !editRow.has_attribute ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-4 text-sm text-muted-foreground sm:col-span-2">
              Attributes are not enabled for{" "}
              <span className="font-medium text-foreground">{editRow.name}</span>. Turn on “Has
              Attribute” for this class on the Item Class screen to add values.
            </div>
          ) : (
            <div className="space-y-3 sm:col-span-2">
              <ChildGrid<ValueRow>
                key={editRow?.id ?? "new"}
                label="Attributes"
                rows={values}
                pageSize={10}
                onAdd={addValueRow}
                onRemove={(v) => removeValueRow(v.key)}
                addLabel="+ Add attribute"
                columns={[
                  {
                    header: "Value",
                    cell: (v) => (
                      <Input
                        value={v.value}
                        uppercase
                        onChange={(e) => setValueAt(v.key, e.target.value)}
                        placeholder="Attribute value"
                        className="text-base md:text-sm"
                      />
                    ),
                  },
                ]}
                renderMobileRow={(v) => (
                  <Input
                    value={v.value}
                    uppercase
                    onChange={(e) => setValueAt(v.key, e.target.value)}
                    placeholder="Attribute value"
                    className="text-base md:text-sm"
                  />
                )}
              />
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
