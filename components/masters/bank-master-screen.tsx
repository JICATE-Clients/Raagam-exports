"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createBank, updateBank, deleteBank } from "@/lib/masters/bank-actions";
import { BANK_TYPES, type Bank, type BankInput, type BankType } from "@/lib/masters/bank-types";
import type { Country } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type CountryOption = Pick<Country, "id" | "code" | "name">;
type BranchRow = {
  key: string;
  country_id: string;
  state: string;
  city: string;
  pin: string;
  street: string;
  land_line: string;
  fax: string;
  email: string;
  swift_rtgs_code: string;
  current_acc_no: string;
  ifs_code: string;
};

const BLANK = { code: "", bank_type: "Foreign" as BankType, name: "", inactive: false };
const blankBranch = (key: string): BranchRow => ({
  key,
  country_id: "",
  state: "",
  city: "",
  pin: "",
  street: "",
  land_line: "",
  fax: "",
  email: "",
  swift_rtgs_code: "",
  current_acc_no: "",
  ifs_code: "",
});

/**
 * Master-detail CRUD for the legacy "Bank" master: header (Code · Foreign/Local ·
 * Name · Inactive) + a "Bank Detail" branch grid. The single code column reads
 * "Swift Code" for Foreign banks and "RTGS/NIFT Code" for Local ones.
 */
export function BankMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Bank[];
  countries: CountryOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `b${keySeq.current++}`;

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));
  const codeLabel = form.bank_type === "Local" ? "RTGS/NIFT Code" : "Swift Code";

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.bank_type].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setBranches([blankBranch(newKey())]);
    setOpen(true);
  }
  function openEdit(r: Bank) {
    setEditId(r.id);
    setForm({ code: r.code ?? "", bank_type: r.bank_type ?? "Foreign", name: r.name, inactive: r.inactive });
    setBranches(
      r.branches.map((b) => ({
        key: newKey(),
        country_id: b.country_id ?? "",
        state: b.state ?? "",
        city: b.city ?? "",
        pin: b.pin ?? "",
        street: b.street ?? "",
        land_line: b.land_line ?? "",
        fax: b.fax ?? "",
        email: b.email ?? "",
        swift_rtgs_code: b.swift_rtgs_code ?? "",
        current_acc_no: b.current_acc_no ?? "",
        ifs_code: b.ifs_code ?? "",
      })),
    );
    setOpen(true);
  }

  function addBranch() {
    setBranches((bs) => [...bs, blankBranch(newKey())]);
  }
  function setBranchAt(key: string, patch: Partial<BranchRow>) {
    setBranches((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }
  function removeBranch(key: string) {
    setBranches((bs) => bs.filter((b) => b.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: BankInput = {
        code: form.code.trim() || null,
        bank_type: form.bank_type,
        name: form.name.trim(),
        inactive: form.inactive,
        branches: branches.map((b, i) => ({
          sno: i + 1,
          country_id: b.country_id || null,
          state: b.state,
          city: b.city,
          pin: b.pin,
          street: b.street,
          land_line: b.land_line,
          fax: b.fax,
          email: b.email,
          swift_rtgs_code: b.swift_rtgs_code,
          current_acc_no: b.current_acc_no,
          ifs_code: b.ifs_code,
        })),
      };
      const res = editId ? await updateBank(editId, payload) : await createBank(payload);
      if (res.ok) {
        success(editId ? "Bank updated." : "Bank added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Bank) {
    startTransition(async () => {
      const res = await deleteBank(r.id);
      if (res.ok) {
        success("Bank deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Bank>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.bank_type ?? "—"}</span> },
    {
      header: "Branches",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.branches.length}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
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
          placeholder="Search bank…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Bank
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No bank records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No bank records yet.
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
                    {r.code ?? "—"} · {r.bank_type ?? "—"} · {r.branches.length} branch
                    {r.branches.length === 1 ? "" : "es"}
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
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bk-code">Code</Label>
              <Input
                id="bk-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label>Type</Label>
              <div className="flex h-9 items-center gap-4">
                {BANK_TYPES.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="bank_type"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={form.bank_type === t}
                      onChange={() => set({ bank_type: t })}
                    />
                    <span className="text-sm text-foreground">{t}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="bk-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="bk-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>

          {/* Bank Detail branch grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Bank Detail
            </div>
            <div className="space-y-3 p-3">
              {branches.length === 0 && <p className="text-xs text-muted-foreground">No branches yet.</p>}
              {branches.map((b, i) => (
                <div key={b.key} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Branch #{i + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => removeBranch(b.key)}
                      aria-label="Remove branch"
                    >
                      ✕
                    </Button>
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Select
                      value={b.country_id}
                      onChange={(e) => setBranchAt(b.key, { country_id: e.target.value })}
                      className="text-base md:text-sm"
                    >
                      <option value="">— Select —</option>
                      {countries.map((c) => (
                        <option key={c.id} value={c.id}>
                          {countryLabel.get(c.id)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="State" value={b.state} onChange={(e) => setBranchAt(b.key, { state: e.target.value })} className="text-base md:text-sm" />
                    <Input placeholder="City" value={b.city} onChange={(e) => setBranchAt(b.key, { city: e.target.value })} className="text-base md:text-sm" />
                    <ValidatedInput format="pincode" placeholder="Pin" value={b.pin} onChange={(e) => setBranchAt(b.key, { pin: e.target.value })} className="text-base md:text-sm" />
                    <Input placeholder="Street" value={b.street} onChange={(e) => setBranchAt(b.key, { street: e.target.value })} className="text-base md:text-sm" />
                    <Input placeholder="Land Line" value={b.land_line} onChange={(e) => setBranchAt(b.key, { land_line: e.target.value })} className="text-base md:text-sm" />
                    <Input placeholder="Fax" value={b.fax} onChange={(e) => setBranchAt(b.key, { fax: e.target.value })} className="text-base md:text-sm" />
                  </div>
                  <ValidatedInput format="email" placeholder="E-Mail" value={b.email} onChange={(e) => setBranchAt(b.key, { email: e.target.value })} className="text-base md:text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder={codeLabel} value={b.swift_rtgs_code} onChange={(e) => setBranchAt(b.key, { swift_rtgs_code: e.target.value })} className="text-base md:text-sm" />
                    <ValidatedInput format="ifsc" placeholder="IFS Code" value={b.ifs_code} onChange={(e) => setBranchAt(b.key, { ifs_code: e.target.value })} className="text-base md:text-sm" />
                  </div>
                  <ValidatedInput format="account" placeholder="Current Acc No" value={b.current_acc_no} onChange={(e) => setBranchAt(b.key, { current_acc_no: e.target.value })} className="text-base md:text-sm" />
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addBranch}>
                + Add branch
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
