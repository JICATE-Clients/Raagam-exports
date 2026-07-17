"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createAllowance,
  updateAllowance,
  deleteAllowance,
} from "@/lib/masters/allowance-actions";
import {
  ALLOWANCE_TYPES,
  type Allowance,
  type AllowanceInput,
  type AllowanceType,
  type CalcType,
} from "@/lib/masters/allowance-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  name: "",
  sequence: "0",
  allowance_type: "Allowance" as AllowanceType,
  inactive: false,
  base_head: false,
  pf_eligible: false,
  esi_eligible: false,
  calc_type: "" as "" | CalcType,
  calc_basis: "",
});

/** Which eligibility flags are set, as a compact "PF · ESI" style label. */
function flagLabel(r: Allowance): string {
  const on = [
    r.base_head && "Base",
    r.pf_eligible && "PF",
    r.esi_eligible && "ESI",
  ].filter(Boolean);
  return on.length ? on.join(" · ") : "—";
}

/**
 * Legacy "Allowance" master (HR). Flat header form: auto ID, Name, Sequence,
 * Type (Allowance / Other Allowance), the Base Head / PF / ESI eligibility
 * flags, and — only for "Other Allowance" — a Fixed/Variable calculation band.
 */
export function AllowanceMasterScreen({ rows, perms }: { rows: Allowance[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));
  const isOther = form.allowance_type === "Other Allowance";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.name, r.allowance_type].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: Allowance) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      name: r.name,
      sequence: String(r.sequence),
      allowance_type: r.allowance_type,
      inactive: r.inactive,
      base_head: r.base_head,
      pf_eligible: r.pf_eligible,
      esi_eligible: r.esi_eligible,
      calc_type: r.calc_type ?? "",
      calc_basis: r.calc_basis ?? "",
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const other = form.allowance_type === "Other Allowance";
      const payload: AllowanceInput = {
        name: form.name.trim(),
        sequence: Number(form.sequence) || 0,
        allowance_type: form.allowance_type,
        inactive: form.inactive,
        base_head: form.base_head,
        pf_eligible: form.pf_eligible,
        esi_eligible: form.esi_eligible,
        // the Fixed/Variable band only applies to "Other Allowance"
        calc_type: other && form.calc_type ? form.calc_type : null,
        calc_basis: other ? form.calc_basis.trim() || null : null,
      };
      const res = editId ? await updateAllowance(editId, payload) : await createAllowance(payload);
      if (res.ok) {
        success(editId ? "Allowance updated." : "Allowance added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Allowance) {
    startTransition(async () => {
      const res = await deleteAllowance(r.id);
      if (res.ok) {
        success("Allowance deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Allowance>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.allowance_type}</span> },
    { header: "Eligibility", cell: (r) => <span className="text-sm text-muted-foreground">{flagLabel(r)}</span> },
    { header: "Seq", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.sequence}</span> },
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
          placeholder="Search allowance…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Allowance
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No allowances yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No allowances yet.
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
                  <div className="text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.allowance_type} · {flagLabel(r)}
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
        title={editId ? `Edit Allowance #${editEntryNo}` : "New Allowance"}
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
              <Label htmlFor="al-id">ID</Label>
              <Input id="al-id" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <label className="flex items-end gap-2 pb-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          </div>

          <div>
            <Label htmlFor="al-name">Name *</Label>
            <Input
              id="al-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="al-seq">Sequence</Label>
              <Input
                id="al-seq"
                type="number"
                min="0"
                value={form.sequence}
                onChange={(e) => set({ sequence: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="al-type">Type</Label>
              <Select
                id="al-type"
                value={form.allowance_type}
                onChange={(e) => set({ allowance_type: e.target.value as AllowanceType })}
                className="text-base md:text-sm"
              >
                {ALLOWANCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* eligibility band */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Eligibility
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(
                [
                  ["base_head", "Base Head"],
                  ["pf_eligible", "PF Eligible"],
                  ["esi_eligible", "ESI Eligible"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form[key]}
                    onChange={(e) => set({ [key]: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Fixed/Variable band — legacy shows this only for "Other Allowance" */}
          {isOther && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Type
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="al_calc_type"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.calc_type === "Fixed"}
                    onChange={() => set({ calc_type: "Fixed" })}
                  />
                  <span className="text-sm text-foreground">Fixed</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="al_calc_type"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.calc_type === "Variable"}
                    onChange={() => set({ calc_type: "Variable" })}
                  />
                  <span className="text-sm text-foreground">Variable</span>
                </label>
                <div className="min-w-[160px] flex-1">
                  <Input
                    value={form.calc_basis}
                    onChange={(e) => set({ calc_basis: e.target.value })}
                    placeholder="Basis…"
                    aria-label="Calculation basis"
                    className="text-base md:text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
