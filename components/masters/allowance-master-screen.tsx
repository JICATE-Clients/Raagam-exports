"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import { type Column } from "@/components/ui/data-table";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { deletedToast } from "@/lib/masters/delete-message";
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
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { ALLOWANCE_NAMES } from "@/lib/masters/name-vocabularies";

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
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const dupError = useDuplicateName({
    table: "allowances",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    seed: ALLOWANCE_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });
  const isOther = form.allowance_type === "Other Allowance";

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
        success(deletedToast("Allowance", res));
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
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [String(r.entry_no), r.name, r.allowance_type].filter(Boolean).join(" ")}
        searchPlaceholder="Search allowance…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Allowance"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No allowances yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => `${r.allowance_type} · ${flagLabel(r)}`,
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
        title={editId ? `Edit Allowance #${editEntryNo}` : "New Allowance"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !!dupError || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/*
          TWO FIELDS A LINE, EVERY BOX THE SAME WIDTH. Client 2026-09-04:
          "i want every box in a 1st box size and only 2 boxes for a line".

          Two rules, and the second is what makes the first look right:

          1. EVERY field is `lg` (6 of 12), so a row holds exactly two and no
             box is wider than its neighbour. The house default is `size="sm"`
             — 3 of 12, FOUR to a row — which is what produced the ragged
             3 + 6 + 3 / 4 line the client rejected: correct by the contract,
             and three different box widths stacked down the form.

          2. The track is CAPPED, because six of twelve is a FRACTION. Against
             the sheet's full width two `lg` boxes come out ~590px each — half
             the dialog per field, which is not "the first box's size", it is
             the same raggedness scaled up. `max-w-3xl` puts each column at
             ~378px, i.e. the width the ID box already had, and the form reads
             as one compact block the way the legacy screen does.

          This is a WIDTH on the container, not a grid: the screen still writes
          no `grid-cols-*`, no `col-span-*` and no `gap-*` — `FieldGrid` takes a
          `className` precisely so a caller can bound the track it lays out in.

          The body it replaced drew its own `grid-cols-1 … sm:grid-cols-2` and
          then overrode it on every child with `sm:col-span-2`, so the track
          never applied at all. That also cost the screen every primitive
          behaviour: a `div > Label + Input` pair is structurally invisible to
          `useRequiredHold`, so "Name *" was a star typed into label text with
          nothing behind it.

          `FieldGrid` rather than `DetailSection` because the Sheet's own title
          already names the record — a bordered card captioned "Details" inside
          a sheet captioned "New Allowance" is the second frame this module was
          just told to stop drawing.
        */}
        <FieldGrid className="max-w-3xl">
          {/* Row 1 — ID · Name */}
          <Field label="ID" size="lg" htmlFor="al-id" skipTab>
            {/*
              `readOnly`, not `disabled`: a disabled input cannot be reached at
              all, while `skipTab` is this repo's way to keep a derived value
              off the typing path with the mouse still able to reach it. The box
              is blank until the row exists — the old "(auto)" described the
              box rather than any state of the record, on a field already marked
              read-only, which is exactly what the de-clutter rule removes.
            */}
            <Input id="al-id" value={editEntryNo ?? ""} readOnly />
          </Field>

          <Field label="Name" size="lg" required htmlFor="al-name">
            <Input
              id="al-name"
              uppercase
              // `allowanceInput.name` is `capsName()`, i.e. `.min(1)` — so a blank
              // one is refused by the action anyway. `required` is what makes the
              // refusal arrive AT THE FIELD, as a hold, instead of as a server
              // error after Save (see useRequiredHold).
              required
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              {...dupFieldProps(dupError, "al-name")}
            />
            <DuplicateError error={dupError} id="al-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => setForm((f) => ({ ...f, name: v }))}
            />
          </Field>


          {/* Row 2 — Sequence · Type */}
          <Field label="Sequence" size="lg" htmlFor="al-seq">
            <Input
              id="al-seq"
              type="number"
              min="0"
              value={form.sequence}
              onChange={(e) => set({ sequence: e.target.value })}
            />
          </Field>

          <Field label="Type" size="lg" htmlFor="al-type">
            <Select
              id="al-type"
              value={form.allowance_type}
              onChange={(e) => set({ allowance_type: e.target.value as AllowanceType })}
            >
              {ALLOWANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            THE CALCULATION PAIR JOINS ROW 2 — it does not open a band of its
            own. Legacy reveals Fixed/Variable and a basis only for "Other
            Allowance", and that conditional half used to be a second bordered
            box with its own "TYPE" caption stacked beneath the form. As a pair
            at the same width as everything else they simply become the next
            line, so nothing above shifts as the operator changes Type.
          */}
          {isOther && (
            <>
              <Field label="Calculation" size="lg">
                {/* A radio set is one field with several controls; the inline
                    gap is intra-control spacing, not page layout. */}
                <div className="flex h-8 items-center gap-4">
                  {(["Fixed", "Variable"] as const).map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="al_calc_type"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.calc_type === t}
                        onChange={() => set({ calc_type: t })}
                      />
                      <span className="text-sm text-foreground">{t}</span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Basis" size="lg" htmlFor="al-basis">
                {/* The placeholder here was "Basis…", which restated the label
                    the field now carries — blanked per the de-clutter rule. */}
                <Input
                  id="al-basis"
                  uppercase
                  value={form.calc_basis}
                  onChange={(e) => set({ calc_basis: e.target.value })}
                />
              </Field>
            </>
          )}

          {/*
            STATUS IS ALWAYS ON THE FORM, ADD INCLUDED (client 2026-09-04: "like
            a toggle so that if i wann make it active or inactive i can do
            that"). It used to render only for an existing row, on the reasoning
            that a record cannot be born switched off — but that was a UI choice
            rather than a constraint: `submit()` sends `inactive: form.inactive`
            on a create exactly as it does on an update, so the row could always
            have been saved inactive and nothing on screen let anyone say so.

            Being unconditional also settles the layout question that used to
            justify hiding it. While it was edit-only it had to sit LAST, or the
            cell it occupies would be missing on the New form and every pair
            after it would swap sides between the two. Now it is present in
            both, so the rows are identical either way and last is simply where
            a record-level flag belongs — after the fields it describes.

            `h-8` puts the switch on the same baseline as the inputs beside it,
            the way `bank-master-screen`'s radio set does.
          */}
          <Field label="Status" size="lg">
            <div className="flex h-8 items-center">
              <Toggle
                checked={form.inactive}
                onChange={(v) => set({ inactive: v })}
                label="Inactive"
              />
            </div>
          </Field>

          {/*
            THREE FLAGS AS ONE FIELD, NOT A BOXED BAND.

            This was a `rounded-lg border` card captioned "ELIGIBILITY": a frame
            drawn around three checkboxes, and a caption naming the box rather
            than any state of the record. Both go — the `Field` label names the
            group and the row it occupies is the grouping. Switches rather than
            bare checkboxes because that is what Orders uses (`Toggle`, in
            Material BOM and Garment Order), and matching Orders is the ask.
          */}
          <Field label="Eligibility" size="full">
            <div className="flex h-8 flex-wrap items-center gap-x-8 gap-y-2">
              {(
                [
                  ["base_head", "Base Head"],
                  ["pf_eligible", "PF Eligible"],
                  ["esi_eligible", "ESI Eligible"],
                ] as const
              ).map(([key, label]) => (
                <Toggle
                  key={key}
                  checked={form[key]}
                  onChange={(v) => set({ [key]: v })}
                  label={label}
                />
              ))}
            </div>
          </Field>
        </FieldGrid>
      </Sheet>
    </div>
  );
}
