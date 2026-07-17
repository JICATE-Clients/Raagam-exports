"use client";

import { useMemo, useState, useTransition } from "react";
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
import {
  createSeason,
  updateSeason,
  deleteSeason,
} from "@/lib/masters/season-actions";
import type { Season, SeasonInput } from "@/lib/masters/season-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = { season: "", season_yr: "", season_name: "", blocked: false };

export function SeasonMasterScreen({
  rows,
  perms,
}: {
  rows: Season[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.season, r.season_yr, r.season_name].filter(Boolean).join(" ").toLowerCase().includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.blocked : v === "inactive" ? !!r.blocked : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Season) {
    setEditId(r.id);
    setForm({
      season: r.season ?? "",
      season_yr: r.season_yr ?? "",
      season_name: r.season_name ?? "",
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: SeasonInput = {
        season: form.season.trim() || null,
        season_yr: form.season_yr.trim() || null,
        season_name: form.season_name.trim() || null,
        blocked: form.blocked,
      };
      const res = editId ? await updateSeason(editId, payload) : await createSeason(payload);
      if (res.ok) {
        success(editId ? "Season updated." : "Season added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Season) {
    startTransition(async () => {
      const res = await deleteSeason(r.id);
      if (res.ok) {
        success("Season deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Season>[] = [
    { header: "Season", cell: (r) => <span className="text-sm">{r.season ?? "—"}</span> },
    { header: "Year", cell: (r) => <span className="text-sm">{r.season_yr ?? "—"}</span> },
    { header: "Season Name", cell: (r) => <span className="text-sm">{r.season_name ?? "—"}</span> },
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
          searchPlaceholder="Search season…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="ssn-filter-status">Status</Label>
            <Select
              id="ssn-filter-status"
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
          <DataIoToolbar entityKey="seasons" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Season
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No season records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No season records yet.
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
                    {r.season_name ?? r.season ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.season_yr ?? "—"}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Inactive" : "Active"}
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
        title={editId ? "Edit Season" : "New Season"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.season.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="ssn-season">Season</Label>
            <Input
              id="ssn-season"
              value={form.season}
              onChange={(e) => setForm({ ...form, season: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="ssn-season-yr">Season Year</Label>
            <Input
              id="ssn-season-yr"
              value={form.season_yr}
              onChange={(e) => setForm({ ...form, season_yr: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="ssn-season-name">Season Name</Label>
            <Input
              id="ssn-season-name"
              value={form.season_name}
              onChange={(e) => setForm({ ...form, season_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => setForm({ ...form, blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
