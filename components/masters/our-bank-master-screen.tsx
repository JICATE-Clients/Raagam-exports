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
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { DetailSection } from "@/components/masters/detail-section";
import {
  createOurBank,
  updateOurBank,
  deleteOurBank,
} from "@/lib/masters/our-bank-actions";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import type { OurBank, OurBankInput } from "@/lib/masters/our-bank-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = { account_no: "", account_name: "", bank_name: "", branch_name: "", swift_code: "", ifsc_code: "", address: "", inactive: false };

export function OurBankMasterScreen({
  rows,
  perms,
}: {
  rows: OurBank[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  // Real-time duplicate check on Account No — mirrors the on-save guard in
  // our-bank-actions (our_banks / account_no).
  const dupError = useDuplicateCheck({
    table: "our_banks",
    name: form.account_no,
    nameColumn: "account_no",
    excludeId: editId ?? undefined,
    enabled: !!form.account_no.trim(),
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(rows, {
    search: (r, q) =>
      [r.account_name, r.bank_name, r.branch_name, r.account_no].filter(Boolean).join(" ").toLowerCase().includes(q),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: OurBank) {
    setEditId(r.id);
    setForm({
      account_no: r.account_no ?? "",
      account_name: r.account_name ?? "",
      bank_name: r.bank_name ?? "",
      branch_name: r.branch_name ?? "",
      swift_code: r.swift_code ?? "",
      ifsc_code: r.ifsc_code ?? "",
      address: r.address ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: OurBankInput = {
        account_no: form.account_no.trim() || null,
        account_name: form.account_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        branch_name: form.branch_name.trim() || null,
        swift_code: form.swift_code.trim() || null,
        ifsc_code: form.ifsc_code.trim() || null,
        address: form.address.trim() || null,
        inactive: form.inactive,
      };
      const res = editId ? await updateOurBank(editId, payload) : await createOurBank(payload);
      if (res.ok) {
        success(editId ? "Bank updated." : "Bank added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: OurBank) {
    startTransition(async () => {
      const res = await deleteOurBank(r.id);
      if (res.ok) {
        success("Bank deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<OurBank>[] = [
    { header: "Account No", cell: (r) => <span className="text-sm">{r.account_no ?? "—"}</span> },
    { header: "Account Name", cell: (r) => <span className="text-sm">{r.account_name ?? "—"}</span> },
    { header: "Bank Name", cell: (r) => <span className="text-sm">{r.bank_name ?? "—"}</span> },
    { header: "Branch", cell: (r) => <span className="text-sm">{r.branch_name ?? "—"}</span> },
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
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
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
          searchPlaceholder="Search bank…"
          activeCount={activeCount}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="ob-filter-status">Status</Label>
            <Select
              id="ob-filter-status"
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
          <DataIoToolbar entityKey="our_banks" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Bank
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No bank records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No bank records yet.
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
                    {r.account_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.bank_name ?? "—"} — {r.branch_name ?? "—"}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Bank" : "New Bank"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.account_name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="ob-account-no">Account No</Label>
              <Input
                id="ob-account-no"
                value={form.account_no}
                onChange={(e) => setForm({ ...form, account_no: e.target.value })}
                className="text-base md:text-sm"
              />
              {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
            </div>
            <div>
              <Label htmlFor="ob-account-name">Account Name</Label>
              <Input
                id="ob-account-name"
                value={form.account_name}
                onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ob-bank-name">Bank Name</Label>
              <Input
                id="ob-bank-name"
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ob-branch-name">Branch Name</Label>
              <Input
                id="ob-branch-name"
                value={form.branch_name}
                onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ob-swift">Swift Code</Label>
              <Input
                id="ob-swift"
                value={form.swift_code}
                onChange={(e) => setForm({ ...form, swift_code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ob-ifsc">IFSC Code</Label>
              <Input
                id="ob-ifsc"
                value={form.ifsc_code}
                onChange={(e) => setForm({ ...form, ifsc_code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="ob-address">Address</Label>
              <Input
                id="ob-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </DetailSection>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
