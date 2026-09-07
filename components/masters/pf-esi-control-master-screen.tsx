"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { type Column } from "@/components/ui/data-table";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createPfEsiControl,
  updatePfEsiControl,
  deletePfEsiControl,
} from "@/lib/masters/pf-esi-control-actions";
import type { PfEsiControl, PfEsiControlInput } from "@/lib/masters/pf-esi-control-types";
import { fmtDate } from "@/lib/format";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({
  entry_date: todayISO(),
  effective_from: todayISO(),
  emp_pf_pct: "0",
  emp_esi_pct: "0",
  empr_pf_pct: "0",
  empr_esi_pct: "0",
});
const pct = (n: number) => `${n.toFixed(2)}%`;

/**
 * PF ESI Control master (HR). Flat, dated rate-version record — Entry No (auto),
 * Date, Effective From, and Employee/Employer PF % + ESI % contributions.
 */
// dup-check: exempt -- a dated rate-version record (Effective From + the PF/ESI
// percentages). A new statutory rate is entered as a new row, so a check on any
// field here would block the only edit this master ever receives.
export function PfEsiControlMasterScreen({ rows, perms }: { rows: PfEsiControl[]; perms: Perms }) {
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
  function openEdit(r: PfEsiControl) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      entry_date: r.entry_date,
      effective_from: r.effective_from,
      emp_pf_pct: String(r.emp_pf_pct),
      emp_esi_pct: String(r.emp_esi_pct),
      empr_pf_pct: String(r.empr_pf_pct),
      empr_esi_pct: String(r.empr_esi_pct),
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: PfEsiControlInput = {
        entry_date: form.entry_date,
        effective_from: form.effective_from,
        emp_pf_pct: Number(form.emp_pf_pct) || 0,
        emp_esi_pct: Number(form.emp_esi_pct) || 0,
        empr_pf_pct: Number(form.empr_pf_pct) || 0,
        empr_esi_pct: Number(form.empr_esi_pct) || 0,
      };
      const res = editId
        ? await updatePfEsiControl(editId, payload)
        : await createPfEsiControl(payload);
      if (res.ok) {
        success(editId ? "PF/ESI control updated." : "PF/ESI control added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: PfEsiControl) {
    startTransition(async () => {
      const res = await deletePfEsiControl(r.id);
      if (res.ok) {
        success("PF/ESI control deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<PfEsiControl>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Effective From", cell: (r) => <span className="text-sm">{fmtDate(r.effective_from)}</span> },
    {
      header: "Employee (PF / ESI)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {pct(r.emp_pf_pct)} / {pct(r.emp_esi_pct)}
        </span>
      ),
    },
    {
      header: "Employer (PF / ESI)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {pct(r.empr_pf_pct)} / {pct(r.empr_esi_pct)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [String(r.entry_no), r.entry_date, r.effective_from].join(" ")}
        searchPlaceholder="Search by entry / date…"
        addLabel="+ Add PF/ESI Control"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No PF/ESI controls yet."
        mobile={{
          title: (r) => `Entry #${r.entry_no} · effective ${fmtDate(r.effective_from)}`,
          meta: (r) =>
            `Employee ${pct(r.emp_pf_pct)}/${pct(r.emp_esi_pct)} · Employer ${pct(r.empr_pf_pct)}/${pct(r.empr_esi_pct)}`,
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editEntryNo ? `Edit PF/ESI Control #${editEntryNo}` : "New PF/ESI Control"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.entry_date || !form.effective_from}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/*
          ROWS ARE SIZED TO SUM TO TWELVE, and here that is 3 + 2 + 2 rather
          than the plain two-a-line the rest of this sub-module uses (client
          2026-09-05: "first 3 shuld be in one line. employee fileds and
          employer fields are sould be visible separately"):

            Entry No 4 + Date 4 + Effective From 4          = 12
            Employee PF 6 + Employee ESI 6                  = 12
            Employer PF 6 + Employer ESI 6                  = 12

          THE ARITHMETIC IS WHAT KEEPS THE TWO PAIRS APART, and getting it wrong
          is what the client was looking at. `Effective From` used to be `lg`,
          leaving six columns free at the end of its row — and a CSS grid does
          not leave a hole, it FLOWS the next cell into it. So Employee PF rose
          onto the dates' row, Employee ESI paired with Employer PF, and the
          employee and employer rates were interleaved on a screen whose whole
          job is telling them apart. A row only closes when its spans fill it.

          The three dates are therefore `md` (4 of 12) and the four rates `lg`
          (6 of 12). That makes row one's boxes narrower than the rates below —
          unavoidable at three-to-a-row, and the grouping is what was asked for.
        */}
        {/*

          THE TWO CAPTIONS MOVED INTO THE LABELS; THEY WERE NOT DELETED, and
          that is the difference between this screen and the others in this
          sweep. Elsewhere a band's caption named the BOX ("ELIGIBILITY",
          "HOLIDAY") and went with it. Here the bands were "Employee
          Contribution" and "Employer Contribution" around four fields labelled
          `PF %`, `ESI %`, `PF %`, `ESI %` — four labels, two distinct names, and
          the only thing telling an employee rate from an employer rate was the
          frame around it. Dropping the frames and keeping those labels would
          have left the form genuinely ambiguous about which percentage is
          whose, on a screen that sets statutory deductions.

          So the distinction is in the label now, where it belongs, and the
          boxes are gone. The de-clutter rule removes text that describes the
          box; this text described the DATA and had been put in a box.
        */}
        <FieldGrid className="max-w-3xl">
          {/* Row 1 — the record's identity: Entry No · Date · Effective From */}
          <Field label="Entry No" size="md" htmlFor="pe-entry" skipTab>
            {/* `readOnly` + `skipTab`, not `disabled`: reachable by mouse, off
                the typing path. The old "(auto)" described the box. */}
            <Input id="pe-entry" value={editEntryNo ?? ""} readOnly />
          </Field>

          <Field label="Date" size="md" required htmlFor="pe-date">
            <Input
              id="pe-date"
              type="date"
              // `pfEsiControlInput.entry_date` is `.min(1)`. Without `required`
              // the hold never fires and a blank one only surfaces as a server
              // error after Save (useRequiredHold, components/ui/field.tsx).
              required
              value={form.entry_date}
              onChange={(e) => set({ entry_date: e.target.value })}
            />
          </Field>

          <Field label="Effective From" size="md" required htmlFor="pe-eff">
            <Input
              id="pe-eff"
              type="date"
              // `.min(1)` in the schema — same reasoning as Date above.
              required
              value={form.effective_from}
              onChange={(e) => set({ effective_from: e.target.value })}
            />
          </Field>

          {/* Row 2 — the employee's two rates, alone on their line */}
          <Field label="Employee PF %" size="lg" htmlFor="pe-emp-pf">
            <Input
              id="pe-emp-pf"
              type="number"
              step="0.01"
              min="0"
              value={form.emp_pf_pct}
              onChange={(e) => set({ emp_pf_pct: e.target.value })}
            />
          </Field>

          <Field label="Employee ESI %" size="lg" htmlFor="pe-emp-esi">
            <Input
              id="pe-emp-esi"
              type="number"
              step="0.01"
              min="0"
              value={form.emp_esi_pct}
              onChange={(e) => set({ emp_esi_pct: e.target.value })}
            />
          </Field>

          {/* Row 3 — the employer's two, in the same order so the columns read
              down as PF then ESI. */}
          <Field label="Employer PF %" size="lg" htmlFor="pe-empr-pf">
            <Input
              id="pe-empr-pf"
              type="number"
              step="0.01"
              min="0"
              value={form.empr_pf_pct}
              onChange={(e) => set({ empr_pf_pct: e.target.value })}
            />
          </Field>

          <Field label="Employer ESI %" size="lg" htmlFor="pe-empr-esi">
            <Input
              id="pe-empr-esi"
              type="number"
              step="0.01"
              min="0"
              value={form.empr_esi_pct}
              onChange={(e) => set({ empr_esi_pct: e.target.value })}
            />
          </Field>
        </FieldGrid>
      </Sheet>
    </div>
  );
}
