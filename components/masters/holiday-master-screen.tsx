"use client";

import { fmtDate } from "@/lib/format";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { createHoliday, updateHoliday, deleteHoliday } from "@/lib/masters/holiday-actions";
import {
  HOLIDAY_CATEGORIES,
  HOLIDAY_PAY_TYPES,
  type HolidayCategory,
  type HolidayPayType,
  type Holiday,
  type HolidayInput,
} from "@/lib/masters/holiday-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({
  entry_date: todayISO(),
  category: "National" as HolidayCategory,
  name: "",
  pay_type: "Paid Holiday" as HolidayPayType,
  is_date_range: false,
  holiday_date: todayISO(),
  end_date: "",
});

/** Human-readable holiday date (single, or from → to). */
function datePhrase(r: Pick<Holiday, "is_date_range" | "holiday_date" | "end_date">): string {
  return r.is_date_range && r.end_date ? `${fmtDate(r.holiday_date)} → ${fmtDate(r.end_date)}` : fmtDate(r.holiday_date);
}

/**
 * Legacy "Holiday" master (HR). Flat header form: auto Entry No, Date, a
 * category radio (National/Festival/Others), Holiday name, a Type radio (Paid
 * Holiday/LOP), and the holiday date — a single date or a from→to range when
 * "Date Range" is ticked.
 */
// dup-check: exempt -- a holiday name recurs every year by definition; DEEPAVALI
// 2026 and DEEPAVALI 2027 are two correct rows. The identity is the name AND the
// date, and the record already carries an auto Entry No.
export function HolidayMasterScreen({ rows, perms }: { rows: Holiday[]; perms: Perms }) {
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
  function openEdit(r: Holiday) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      entry_date: r.entry_date,
      category: r.category ?? "National",
      name: r.name,
      pay_type: r.pay_type ?? "Paid Holiday",
      is_date_range: r.is_date_range,
      holiday_date: r.holiday_date,
      end_date: r.end_date ?? "",
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: HolidayInput = {
        entry_date: form.entry_date,
        category: form.category,
        name: form.name.trim(),
        pay_type: form.pay_type,
        is_date_range: form.is_date_range,
        holiday_date: form.holiday_date,
        end_date: form.is_date_range ? form.end_date || null : null,
      };
      const res = editId ? await updateHoliday(editId, payload) : await createHoliday(payload);
      if (res.ok) {
        success(editId ? "Holiday updated." : "Holiday added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Holiday) {
    startTransition(async () => {
      const res = await deleteHoliday(r.id);
      if (res.ok) {
        success("Holiday deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Holiday>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Holiday", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Category",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.category ?? "—"}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-sm text-muted-foreground">{datePhrase(r)}</span>,
    },
    {
      header: "Type",
      cell: (r) => (
        <StatusPill tone={r.pay_type === "LOP" ? "warning" : "success"}>
          {r.pay_type ?? "—"}
        </StatusPill>
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
          [String(r.entry_no), r.name, r.category, r.pay_type, datePhrase(r)]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search holiday…"
        addLabel="+ Add Holiday"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No holidays yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => `${r.category ?? "—"} · ${datePhrase(r)}`,
          pill: (r) => (
            <StatusPill tone={r.pay_type === "LOP" ? "warning" : "success"}>
              {r.pay_type ?? "—"}
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
        title={editId ? `Edit Holiday #${editEntryNo}` : "New Holiday"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.name.trim() || !form.holiday_date}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/*
          Same two rules Allowance settled and the client then asked for here:
          every field `lg` (6 of 12, so a row holds exactly two and no box is
          wider than its neighbour) inside a capped track, so six-of-twelve
          resolves to ~378px instead of half the dialog.

          WHAT WENT WITH THEM WERE THE BANDS. This form drew two bordered,
          captioned boxes — "HOLIDAY" around the category radios and an unnamed
          one around the Date Range tick and its dates — plus the outer
          hand-written `sm:grid-cols-2` that every child then overrode. Four
          frames inside a dialog that is already a frame (client 2026-09-04:
          "there are so many extra boxes and lines remove them").

          A radio set is ONE FIELD with several controls, so it needs a `Field`
          label, not a box and a caption. That is the whole substitution here.
        */}
        <FieldGrid className="max-w-3xl">
          {/* Row 1 — Entry No · Date */}
          <Field label="Entry No" size="lg" htmlFor="hd-entry" skipTab>
            {/* `readOnly` + `skipTab`, not `disabled`: the value is reachable by
                mouse and off the typing path. The old "(auto)" described the box
                rather than the record, on a field already read-only. */}
            <Input id="hd-entry" value={editEntryNo ?? ""} readOnly />
          </Field>

          <Field label="Date" size="lg" required htmlFor="hd-date">
            <Input
              id="hd-date"
              type="date"
              // `.min(1)` in `holidayInput`. Name already declared itself; these
              // two did not, so the screen held on one of its three mandatory
              // fields and waved the other two through.
              required
              value={form.entry_date}
              onChange={(e) => set({ entry_date: e.target.value })}
            />
          </Field>

          {/* Row 2 — Holiday · Category */}
          <Field label="Holiday" size="lg" required htmlFor="hd-name">
            <Input
              id="hd-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
            />
          </Field>

          {/*
            LABELLED "CATEGORY", NOT "HOLIDAY" — the band it replaced was
            captioned "HOLIDAY" and sat directly above a text field also called
            Holiday. Inside a box the two read as heading and content; as two
            fields on one row they would be the same word twice, naming
            different things. `category` is what the value is called in the
            form, the type and the column.

            `h-8` puts the radios on the same baseline as the input beside them,
            the way `bank-master-screen`'s radio set does.
          */}
          <Field label="Category" size="lg">
            <div className="flex h-8 flex-wrap items-center gap-4">
              {HOLIDAY_CATEGORIES.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="hd-category"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.category === c}
                    onChange={() => set({ category: c })}
                  />
                  <span className="text-sm text-foreground">{c}</span>
                </label>
              ))}
            </div>
          </Field>

          {/* Row 3 — Type · Date Range */}
          <Field label="Type" size="lg">
            <div className="flex h-8 flex-wrap items-center gap-4">
              {HOLIDAY_PAY_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="hd-paytype"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.pay_type === t}
                    onChange={() => set({ pay_type: t })}
                  />
                  <span className="text-sm text-foreground">{t}</span>
                </label>
              ))}
            </div>
          </Field>

          {/*
            The tick that was the box's heading becomes a field of its own — a
            switch, matching every other boolean in this module. It governs the
            two dates below rather than containing them: the row it opens is the
            next line, not a nested panel.
          */}
          <Field label="Date Range" size="lg">
            <div className="flex h-8 items-center">
              <Toggle
                checked={form.is_date_range}
                onChange={(v) => set({ is_date_range: v })}
                label="Spans more than one day"
              />
            </div>
          </Field>

          {/* Row 4 — the holiday's own date, and its end when it is a range */}
          <Field
            label={form.is_date_range ? "From" : "Holiday Date"}
            size="lg"
            required
            htmlFor="hd-hdate"
          >
            <Input
              id="hd-hdate"
              type="date"
              // `.min(1)` in `holidayInput`, and Save is already gated on it
              // — the screen knew, the field did not.
              required
              value={form.holiday_date}
              onChange={(e) => set({ holiday_date: e.target.value })}
            />
          </Field>

          {form.is_date_range && (
            <Field label="To" size="lg" htmlFor="hd-edate">
              <Input
                id="hd-edate"
                type="date"
                value={form.end_date}
                min={form.holiday_date || undefined}
                onChange={(e) => set({ end_date: e.target.value })}
              />
            </Field>
          )}
        </FieldGrid>
      </Sheet>
    </div>
  );
}
