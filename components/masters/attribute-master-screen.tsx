"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import {
  createAttribute,
  updateAttribute,
} from "@/lib/masters/extras-actions";
import { type Attribute, type AttributeInput } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };
type ValueRow = { key: string; value: string };

const BLANK = {
  code: "",
  name: "",
  type_code: "",
  notes: "",
  inactive: false,
};

// Fixed legacy list — the old RP-Software Attribute editor hardcoded this
// exact 8-value Type dropdown; matches the type_code values already stored
// on existing rows (CAP, FAB, GAR, GEN, PAK, SEW, YRN).
const TYPE_OPTIONS = [
  { code: "YRN", label: "Yarn" },
  { code: "FAB", label: "Fabric" },
  { code: "SEW", label: "Sewing Accessories" },
  { code: "PAK", label: "Packing Accessories" },
  { code: "GEN", label: "General" },
  { code: "GAR", label: "Garments" },
  { code: "CON", label: "Consumables" },
  { code: "CAP", label: "Capital Items" },
] as const;
const TYPE_LABELS = new Map<string, string>(TYPE_OPTIONS.map((t) => [t.code, t.label]));

/**
 * Attributes = Item Class (config_lookups kind `item_class`, merged 0293) —
 * Code/Name/Type/Inactive header, plus a child grid of named attribute values
 * (e.g. GSM, Width) that Material Attribute Lines pick from. Dense table on
 * desktop, record cards on mobile, shared <Sheet> editor.
 */
export function AttributeMasterScreen({
  rows,
  perms,
}: {
  rows: Attribute[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [values, setValues] = useState<ValueRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `v${keySeq.current++}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.code, r.name, r.type_code, r.notes, ...r.values.map((v) => v.value)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
        type: (r, v) => r.type_code === v,
      },
      initialFilters: { status: "", type: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setValues([]);
    setOpen(true);
  }
  function openEdit(r: Attribute) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      type_code: r.type_code ?? "",
      notes: r.notes ?? "",
      inactive: !r.is_active,
    });
    setValues(r.values.map((v) => ({ key: newKey(), value: v.value })));
    setOpen(true);
  }

  function addValueRow() {
    setValues((vs) => [...vs, { key: newKey(), value: "" }]);
  }
  function setValueAt(key: string, value: string) {
    setValues((vs) => vs.map((v) => (v.key === key ? { ...v, value } : v)));
  }
  function removeValueRow(key: string) {
    setValues((vs) => vs.filter((v) => v.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: AttributeInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        type_code: form.type_code.trim() || null,
        notes: form.notes.trim() || null,
        is_active: !form.inactive,
        values: values
          .filter((v) => v.value.trim())
          .map((v, i) => ({ sno: i + 1, value: v.value.trim() })),
      };
      const res = editId
        ? await updateAttribute(editId, payload)
        : await createAttribute(payload);
      if (res.ok) {
        success(editId ? "Attribute updated." : "Attribute added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: Attribute) {
    startTransition(async () => {
      const payload: AttributeInput = {
        code: r.code ?? null,
        name: r.name,
        type_code: r.type_code ?? null,
        notes: r.notes ?? null,
        is_active: false,
        values: r.values.map((v) => ({ sno: v.sno, value: v.value })),
      };
      const res = await updateAttribute(r.id, payload);
      if (res.ok) {
        success("Attribute marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Attribute>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Type",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.type_code ? TYPE_LABELS.get(r.type_code) ?? r.type_code : "—"}
        </span>
      ),
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
              Edit
            </Button>
          )}
          {perms.canDelete && r.is_active && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => deactivate(r)}
            >
              Deactivate
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
          searchPlaceholder="Search attribute…"
          activeCount={activeCount}
          onReset={reset}
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
            <Label htmlFor="at-filter-type">Type</Label>
            <Select
              id="at-filter-type"
              value={filterValues.type}
              onChange={(e) => {
                setFilter("type", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="attributes" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Attribute
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={pg.paged}
          getKey={(r) => r.id}
          empty="No attribute records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No attribute records yet.
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
                    {r.name}
                  </div>
                  {r.code && <div className="mt-0.5 text-xs text-muted-foreground">{r.code}</div>}
                </div>
                <StatusPill tone={r.is_active ? "success" : "danger"}>
                  {r.is_active ? "Active" : "Inactive"}
                </StatusPill>
              </div>
              {r.values.length > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.values.length} value{r.values.length === 1 ? "" : "s"}
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
        title={editId ? "Edit Attribute" : "New Attribute"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.name.trim()}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="at-code">Code</Label>
              <Input
                id="at-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Unique code"
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="at-type">Type</Label>
              <Select
                id="at-type"
                value={form.type_code}
                onChange={(e) => setForm({ ...form, type_code: e.target.value })}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="at-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="at-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="at-notes">Notes</Label>
            <Textarea
              id="at-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="text-base md:text-sm"
            />
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

          {/* value grid — named properties (GSM, Width, …) scoped to this Item Class */}
          <ChildGrid<ValueRow>
            label="Attributes"
            rows={values}
            onAdd={addValueRow}
            onRemove={(v) => removeValueRow(v.key)}
            addLabel="+ Add attribute"
            columns={[
              {
                header: "Value",
                cell: (v) => (
                  <Input
                    value={v.value}
                    onChange={(e) => setValueAt(v.key, e.target.value)}
                    placeholder="Attribute value"
                    className="text-base md:text-sm"
                  />
                ),
              },
            ]}
          />
        </div>
      </Sheet>
    </div>
  );
}
