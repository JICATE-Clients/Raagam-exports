"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
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
            <Field label="Entry No" size="sm" htmlFor="rt-entry">
              <Input id="rt-entry" value={editEntryNo ?? "(auto)"} disabled />
            </Field>
            <Field label="Date" size="sm" htmlFor="rt-date">
              <Input
                id="rt-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
              />
            </Field>
            <Field label="Pay Mode" size="md" htmlFor="rt-paymode">
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
            <Field label="Credit Days" size="xs" htmlFor="rt-credit">
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
            <Field label="With Interest" size="md">
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
              <Field size="md">
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
            <Field label="Description" size="full" htmlFor="rt-desc">
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
              per-field captions would break the sentence. Three `md` = 12. */}
          <DetailSection label="AT" cols={12}>
            <Field size="md">
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
            <Field size="md">
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
            <Field size="md">
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
