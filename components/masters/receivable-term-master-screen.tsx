"use client";

import { fmtDate } from "@/lib/format";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, type FieldSize } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid } from "@/components/masters/section-grid";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  createReceivableTerm,
  updateReceivableTerm,
  deleteReceivableTerm,
} from "@/lib/masters/receivable-term-actions";
import {
  PAY_MODES,
  AT_BASIS,
  AT_WHEN,
  AT_EVENT,
  type AtBasis,
  type AtEvent,
  type AtWhen,
  type PayMode,
  type ReceivableTerm,
  type ReceivableTermInput,
} from "@/lib/masters/receivable-term-types";

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
  inactive: false,
});

/**
 * How wide each field is on the 12-column track (LAYOUT.md §3).
 *
 * `sm` (3 of 12 — four per row) is the working default and nothing on this form
 * argues its way out of it: a Pay Mode is a 2-6 character code (CHEQUE, DA, LC),
 * a date is a date, an entry number is three digits. Pay Mode was `md`, which
 * held a row to three fields for a value that never needed the width (client
 * 2026-07-29).
 *
 * Both sections sit in a `SectionGrid`, so each is only ~583px wide and one
 * `sm` is ~137px — already narrow. That is why Credit Days moved UP from `xs`
 * (~87px): it lands row 1 exactly on 12, and `xs` here is small enough to crowd
 * a 3-digit number against its own spinner.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 — a row past 12 does not shrink, its last
 * field wraps onto a line of its own with the rest of that line left empty.
 *   Details row 1  entry_no 3 + entry_date 3 + pay_mode 3 + credit_days 3 = 12
 *   Details row 2  with_interest 3 + inactive 3 (edit only)              =  6
 *   Details row 3  description 12
 *   AT      row 1  at_basis 3 + at_when 3 + at_event 6                   = 12
 *
 * Row 2 is deliberately short: the only fields left are two toggles, and
 * Description is a textarea, which §3 keeps at `full`. Nothing can be pulled up
 * to fill it without giving the textarea a partial row.
 *
 * `payment-term-master-screen.tsx` is the same form for the other side of the
 * ledger and carries an identical map — change one, change both.
 */
const FIELD_SIZE = {
  entry_no: "sm", // 3 — server-assigned, three digits; `sm` keeps row 1 flush
  entry_date: "sm", // 3 — a native date control needs ~130px
  pay_mode: "sm", // 3 — CHEQUE · DA · DD · DP · LC · OTH · PDC · TT
  credit_days: "sm", // 3 — 0-90; see the note above on `xs` in a half-width section
  with_interest: "sm", // 3 — a Yes/No radio pair, both captions on one line
  inactive: "sm", // 3 — a tick box; it only needs room for its own caption
  description: "full", // 12 — a textarea stands alone (LAYOUT.md §3)
  at_basis: "sm", // 3 — SIGHT · OPEN · DAYS
  at_when: "sm", // 3 — AFTER · FROM
  at_event: "sm", // 3 — "RECEIPT OF DOCUMENTS" now scrolls inside the box
  //                     (uniform 4-per-row, client 2026-07-29)
} satisfies Record<string, FieldSize>;

/** Human-readable "AT" phrase from the three dropdowns. */
function atPhrase(r: Pick<ReceivableTerm, "at_basis" | "at_when" | "at_event" | "credit_days">): string {
  const parts = [
    r.at_basis === "DAYS" && r.credit_days ? `${r.credit_days} DAYS` : r.at_basis,
    r.at_when,
    r.at_event,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

/**
 * Legacy "Receivable term" master (Associates). Flat header form: auto Entry No,
 * Date, Pay Mode, an "AT" phrase built from three dropdowns, With Interest,
 * Credit Days, Description, Inactive.
 */
export function ReceivableTermMasterScreen({ rows, perms }: { rows: ReceivableTerm[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: ReceivableTerm) {
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
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: ReceivableTermInput = {
        entry_date: form.entry_date,
        pay_mode: form.pay_mode ? form.pay_mode : null,
        at_basis: form.at_basis ? form.at_basis : null,
        at_when: form.at_when ? form.at_when : null,
        at_event: form.at_event ? form.at_event : null,
        with_interest: form.with_interest,
        credit_days: Number(form.credit_days) || 0,
        description: form.description.trim() || null,
        inactive: form.inactive,
      };
      const res = editId ? await updateReceivableTerm(editId, payload) : await createReceivableTerm(payload);
      if (res.ok) {
        success(editId ? "Receivable term updated." : "Receivable term added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ReceivableTerm) {
    startTransition(async () => {
      const res = await deleteReceivableTerm(r.id);
      if (res.ok) {
        success(deletedToast("Receivable term", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ReceivableTerm>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{fmtDate(r.entry_date)}</span> },
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
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [String(r.entry_no), r.pay_mode, atPhrase(r), r.description].filter(Boolean).join(" ")
        }
        searchPlaceholder="Search receivable term…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Receivable Term"
        onAdd={openAdd}
        columns={columns}
        empty="No receivable terms yet."
        mobile={{
          title: (r) => `Entry #${r.entry_no} · ${r.pay_mode ?? "—"}`,
          meta: (r) => `${atPhrase(r)} · ${r.with_interest ? "With interest" : "No interest"}`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Receivable Term #${editEntryNo}` : "New Receivable Term"}
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
        {/* Eight fields, so titled sections rather than one flat list
            (LAYOUT.md §4). "AT" was already its own bordered card hand-rolled
            in the screen — it is a real legacy grouping, so it becomes a proper
            DetailSection instead. */}
        <SectionGrid>
          <DetailSection label="Details" cols={12}>
            {/* Entry No is server-assigned; `disabled` already keeps it out of
                the Tab order, so it needs no skipTab. */}
            <Field label="Entry No" size={FIELD_SIZE.entry_no} htmlFor="rt-entry">
              <Input id="rt-entry" value={editEntryNo ?? "(auto)"} disabled />
            </Field>
            <Field label="Date" size={FIELD_SIZE.entry_date} htmlFor="rt-date">
              <Input
                id="rt-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
              />
            </Field>
            <Field label="Pay Mode" size={FIELD_SIZE.pay_mode} htmlFor="rt-paymode">
              <Select
                id="rt-paymode"
                value={form.pay_mode}
                onChange={(e) => set({ pay_mode: e.target.value as "" | PayMode })}
              >
                <option value="">— Select —</option>
                {PAY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Credit Days" size={FIELD_SIZE.credit_days} htmlFor="rt-credit">
              <Input
                id="rt-credit"
                type="number"
                min="0"
                value={form.credit_days}
                onChange={(e) => set({ credit_days: e.target.value })}
              />
            </Field>
            {/* A radio pair is one field with two controls — it keeps its own
                inline gaps, which are intra-control spacing, not page layout. */}
            <Field label="With Interest" size={FIELD_SIZE.with_interest}>
              <div className="flex h-8 items-center gap-4">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="with_interest"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.with_interest}
                    onChange={() => set({ with_interest: true })}
                  />
                  <span className="text-sm text-foreground">Yes</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="with_interest"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={!form.with_interest}
                    onChange={() => set({ with_interest: false })}
                  />
                  <span className="text-sm text-foreground">No</span>
                </label>
              </div>
            </Field>
            {editId && (
              <Field size={FIELD_SIZE.inactive}>
                <label className="flex h-8 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.inactive}
                    onChange={(e) => set({ inactive: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              </Field>
            )}
            <Field label="Description" size={FIELD_SIZE.description} htmlFor="rt-desc">
              <Textarea
                id="rt-desc"
                rows={3}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
          </DetailSection>

          {/* The three dropdowns read as one phrase ("AT <basis> <when>
              <event>"), so they stay unlabelled and keep their aria-labels —
              per-field captions would break the sentence. Widths are the
              phrase's own shape, not three equal thirds: two short enums at
              `sm` and the event list at `lg`, because "RECEIPT OF DOCUMENTS"
              is 20 characters and the other two are one word. 3+3+6 = 12. */}
          <DetailSection label="AT" cols={12}>
            <Field size={FIELD_SIZE.at_basis}>
              <Select
                value={form.at_basis}
                onChange={(e) => set({ at_basis: e.target.value as "" | AtBasis })}
                aria-label="AT basis"
              >
                <option value="">—</option>
                {AT_BASIS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field size={FIELD_SIZE.at_when}>
              <Select
                value={form.at_when}
                onChange={(e) => set({ at_when: e.target.value as "" | AtWhen })}
                aria-label="AT when"
              >
                <option value="">—</option>
                {AT_WHEN.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field size={FIELD_SIZE.at_event}>
              <Select
                value={form.at_event}
                onChange={(e) => set({ at_event: e.target.value as "" | AtEvent })}
                aria-label="AT event"
              >
                <option value="">—</option>
                {AT_EVENT.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </DetailSection>
        </SectionGrid>
      </Sheet>
    </div>
  );
}
