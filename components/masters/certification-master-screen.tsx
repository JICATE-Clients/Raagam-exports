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
import {
  createCertification,
  updateCertification,
  deactivateCertification,
} from "@/lib/masters/certification-actions";
import type { Certification, CertificationInput } from "@/lib/masters/certification-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };
type ChildRow = { key: string; valid_from: string; valid_to: string };

const BLANK = {
  certification_name: "",
  description: "",
  inactive: false,
};

export function CertificationMasterScreen({
  rows,
  perms,
}: {
  rows: Certification[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const keyRef = useRef(0);
  const nextKey = () => `cert-${++keyRef.current}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.certification_name, r.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !r.blocked : v === "inactive" ? !!r.blocked : true),
      },
      initialFilters: { status: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([]);
    setOpen(true);
  }
  function openEdit(r: Certification) {
    setEditId(r.id);
    setForm({
      certification_name: r.certification_name,
      description: r.description ?? "",
      inactive: r.blocked,
    });
    setChildRows(
      (r.validities ?? []).map((v) => ({
        key: nextKey(),
        valid_from: v.valid_from ?? "",
        valid_to: v.valid_to ?? "",
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), valid_from: "", valid_to: "" }]);
  }
  function updateChild(key: string, field: "valid_from" | "valid_to", value: string) {
    setChildRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: CertificationInput = {
        certification_name: form.certification_name.trim(),
        description: form.description.trim() || null,
        blocked: form.inactive,
      };
      const children = childRows
        .filter((c) => c.valid_from.trim() || c.valid_to.trim())
        .map((c) => ({
          valid_from: c.valid_from.trim() || null,
          valid_to: c.valid_to.trim() || null,
        }));
      const res = editId
        ? await updateCertification(editId, payload, children)
        : await createCertification(payload, children);
      if (res.ok) {
        success(editId ? "Certification updated." : "Certification added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: Certification) {
    startTransition(async () => {
      const res = await deactivateCertification(r.id);
      if (res.ok) {
        success("Certification marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Certification>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.certification_name}</span> },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.description ?? "---"}</span>
      ),
    },
    {
      header: "Validities",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.validities?.length || "---"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>
          {r.blocked ? "Inactive" : "Active"}
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
          {perms.canDelete && !r.blocked && (
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
          searchPlaceholder="Search certification..."
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="cert-filter-status">Status</Label>
            <Select
              id="cert-filter-status"
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
          <DataIoToolbar entityKey="certifications" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Certification
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
          empty="No certification records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No certification records yet.
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
                    {r.certification_name}
                  </div>
                  {r.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.description}
                    </div>
                  )}
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.validities?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.validities!.length} validity period{r.validities!.length === 1 ? "" : "s"}
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
        title={editId ? "Edit Certification" : "New Certification"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.certification_name.trim()}
              onClick={submit}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cert-name">
              Certification Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="cert-name"
              value={form.certification_name}
              onChange={(e) => setForm({ ...form, certification_name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cert-desc">Description</Label>
            <Textarea
              id="cert-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
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

          {/* child grid: validity periods */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium">Validity Periods</span>
              <Button variant="ghost" size="sm" onClick={addChildRow}>
                + Add
              </Button>
            </div>
            <div className="space-y-2 p-3">
              {childRows.length === 0 && (
                <p className="text-xs text-muted-foreground">No validity periods yet.</p>
              )}
              {childRows.map((row, i) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    type="date"
                    value={row.valid_from}
                    onChange={(e) => updateChild(row.key, "valid_from", e.target.value)}
                    className="flex-1 text-base md:text-sm"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={row.valid_to}
                    onChange={(e) => updateChild(row.key, "valid_to", e.target.value)}
                    className="flex-1 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeChildRow(row.key)}
                    aria-label="Remove validity"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
