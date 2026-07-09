"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createPaymentTerm,
  updatePaymentTerm,
  deletePaymentTerm,
} from "@/lib/masters/payment-term-actions";
import {
  PAY_MODES,
  AT_BASIS,
  AT_WHEN,
  AT_EVENT,
  type AtBasis,
  type AtEvent,
  type AtWhen,
  type PayMode,
  type PaymentTerm,
  type PaymentTermInput,
} from "@/lib/masters/payment-term-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({
  entry_date: todayISO(),
  pay_mode: "" as "" | PayMode,
  at_basis: "" as "" | AtBasis,
  at_when: "" as "" | AtWhen,
  at_event: "" as "" | AtEvent,
  with_interest: false,
  credit_days: "0",
  description: "",
  blocked: false,
});

/** Human-readable "AT" phrase from the three dropdowns. */
function atPhrase(r: Pick<PaymentTerm, "at_basis" | "at_when" | "at_event" | "credit_days">): string {
  const parts = [
    r.at_basis === "DAYS" && r.credit_days ? `${r.credit_days} DAYS` : r.at_basis,
    r.at_when,
    r.at_event,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

/**
 * Legacy "Payment term" master (Associates). Flat header form: auto Entry No,
 * Date, Pay Mode, an "AT" phrase built from three dropdowns, With Interest,
 * Credit Days, Description, Blocked.
 */
export function PaymentTermMasterScreen({ rows, perms }: { rows: PaymentTerm[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.pay_mode, atPhrase(r), r.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: PaymentTerm) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      entry_date: r.entry_date,
      pay_mode: r.pay_mode ?? "",
      at_basis: r.at_basis ?? "",
      at_when: r.at_when ?? "",
      at_event: r.at_event ?? "",
      with_interest: r.with_interest,
      credit_days: String(r.credit_days),
      description: r.description ?? "",
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: PaymentTermInput = {
        entry_date: form.entry_date,
        pay_mode: form.pay_mode ? form.pay_mode : null,
        at_basis: form.at_basis ? form.at_basis : null,
        at_when: form.at_when ? form.at_when : null,
        at_event: form.at_event ? form.at_event : null,
        with_interest: form.with_interest,
        credit_days: Number(form.credit_days) || 0,
        description: form.description.trim() || null,
        blocked: form.blocked,
      };
      const res = editId ? await updatePaymentTerm(editId, payload) : await createPaymentTerm(payload);
      if (res.ok) {
        success(editId ? "Payment term updated." : "Payment term added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: PaymentTerm) {
    startTransition(async () => {
      const res = await deletePaymentTerm(r.id);
      if (res.ok) {
        success("Payment term deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PaymentTerm>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.entry_date}</span> },
    { header: "Pay Mode", cell: (r) => <span className="text-sm">{r.pay_mode ?? "—"}</span> },
    { header: "AT", cell: (r) => <span className="text-sm text-muted-foreground">{atPhrase(r)}</span> },
    {
      header: "Interest",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.with_interest ? "Yes" : "No"}</span>,
    },
    { header: "Credit Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.credit_days}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill>
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
          placeholder="Search payment term…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Payment Term
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No payment terms yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No payment terms yet.
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
                  <div className="text-[15px] font-semibold text-foreground">
                    Entry #{r.entry_no} · {r.pay_mode ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {atPhrase(r)} · {r.with_interest ? "With interest" : "No interest"}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
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
        title={editId ? `Edit Payment Term #${editEntryNo}` : "New Payment Term"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.entry_date} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pt-entry">Entry No</Label>
              <Input id="pt-entry" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="pt-date">Date</Label>
              <Input
                id="pt-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pt-paymode">Pay Mode</Label>
            <Select
              id="pt-paymode"
              value={form.pay_mode}
              onChange={(e) => set({ pay_mode: e.target.value as "" | PayMode })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {PAY_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>

          {/* AT phrase — three dropdowns */}
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AT</div>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={form.at_basis}
                onChange={(e) => set({ at_basis: e.target.value as "" | AtBasis })}
                className="text-base md:text-sm"
                aria-label="AT basis"
              >
                <option value="">—</option>
                {AT_BASIS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
              <Select
                value={form.at_when}
                onChange={(e) => set({ at_when: e.target.value as "" | AtWhen })}
                className="text-base md:text-sm"
                aria-label="AT when"
              >
                <option value="">—</option>
                {AT_WHEN.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
              <Select
                value={form.at_event}
                onChange={(e) => set({ at_event: e.target.value as "" | AtEvent })}
                className="text-base md:text-sm"
                aria-label="AT event"
              >
                <option value="">—</option>
                {AT_EVENT.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-foreground">With Interest</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="pt_with_interest"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.with_interest}
                onChange={() => set({ with_interest: true })}
              />
              <span className="text-sm text-foreground">Yes</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="pt_with_interest"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={!form.with_interest}
                onChange={() => set({ with_interest: false })}
              />
              <span className="text-sm text-foreground">No</span>
            </label>
          </div>

          <div>
            <Label htmlFor="pt-credit">Credit Days</Label>
            <Input
              id="pt-credit"
              type="number"
              min="0"
              value={form.credit_days}
              onChange={(e) => set({ credit_days: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pt-desc">Description</Label>
            <Textarea
              id="pt-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => set({ blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
