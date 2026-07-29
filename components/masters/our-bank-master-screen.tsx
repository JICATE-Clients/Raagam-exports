"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Field, type FieldSize } from "@/components/ui/field";
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

/**
 * How wide each field is on the 12-column track (LAYOUT.md §3).
 *
 * `sm` (3 of 12 — four per row) is the working default, and every identifier on
 * this form is fixed-width: an account number, an 8/11-character SWIFT, an
 * 11-character IFSC. The three NAME fields were `lg` (half a row each), which
 * put three fields on a row that holds four (client 2026-07-29); at `sm` they
 * are still ~275px in the 1180px editor, i.e. ~34 characters of a bank name.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 — a row past 12 does not shrink, its last
 * field wraps onto a line of its own with the rest of that line left empty.
 *   row 1   account_no 3 + account_name 3 + bank_name 3 + branch_name 3 = 12
 *   row 2   swift_code 3 + ifsc_code 3 + address 6                      = 12
 *   row 3   inactive 3   (edit only — which is why it is LAST: rows 1-2 then
 *                         look identical in New and in Edit)
 */
const FIELD_SIZE = {
  account_no: "sm", // 3 — a fixed-width identifier, never free text
  account_name: "sm", // 3 — "RAAGAM EXPORTS CURRENT A/C" fits at ~34 chars
  bank_name: "sm", // 3 — "STATE BANK OF INDIA"
  branch_name: "sm", // 3 — "PEELAMEDU"
  swift_code: "sm", // 3 — 8 or 11 characters
  ifsc_code: "sm", // 3 — exactly 11 characters
  address: "lg", // 6 — the one free-text line on the form (LAYOUT.md §3)
  inactive: "sm", // 3 — a tick box; it only needs room for its own caption
} satisfies Record<string, FieldSize>;

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
    searchKey: (r) => [r.account_name, r.bank_name, r.branch_name, r.account_no].filter(Boolean).join(" "),
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
        {/* Seven fields — one titled section (LAYOUT.md §4), on the 12-col track
            so the two 11-character codes stop claiming half a row each. Legacy
            field order preserved. Widths come from FIELD_SIZE above, which
            carries the per-row arithmetic. */}
        <DetailSection label="Details" cols={12}>
          <Field label="Account No" size={FIELD_SIZE.account_no} htmlFor="ob-account-no">
            <ValidatedInput
              id="ob-account-no"
              format="account"
              value={form.account_no}
              onChange={(e) => setForm({ ...form, account_no: e.target.value })}
            />
            {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
          </Field>
          <Field label="Account Name" size={FIELD_SIZE.account_name} htmlFor="ob-account-name">
            <Input
              id="ob-account-name"
              uppercase
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            />
          </Field>
          <Field label="Bank Name" size={FIELD_SIZE.bank_name} htmlFor="ob-bank-name">
            <Input
              id="ob-bank-name"
              uppercase
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            />
          </Field>
          <Field label="Branch Name" size={FIELD_SIZE.branch_name} htmlFor="ob-branch-name">
            <Input
              id="ob-branch-name"
              uppercase
              value={form.branch_name}
              onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
            />
          </Field>
          <Field label="Swift Code" size={FIELD_SIZE.swift_code} htmlFor="ob-swift">
            <ValidatedInput
              id="ob-swift"
              format="swift"
              value={form.swift_code}
              onChange={(e) => setForm({ ...form, swift_code: e.target.value })}
            />
          </Field>
          <Field label="IFSC Code" size={FIELD_SIZE.ifsc_code} htmlFor="ob-ifsc">
            <ValidatedInput
              id="ob-ifsc"
              format="ifsc"
              value={form.ifsc_code}
              onChange={(e) => setForm({ ...form, ifsc_code: e.target.value })}
            />
          </Field>
          <Field label="Address" size={FIELD_SIZE.address} htmlFor="ob-address">
            <Input
              id="ob-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          {editId && (
            <Field size={FIELD_SIZE.inactive}>
              <label className="flex h-8 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.inactive}
                  onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
                />
                <span className="text-sm text-foreground">Inactive</span>
              </label>
            </Field>
          )}
        </DetailSection>
      </Sheet>
    </div>
  );
}
