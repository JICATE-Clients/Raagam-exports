"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useBlockAction } from "@/components/masters/use-block-action";
import { CountryPicker } from "@/components/masters/country-picker";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { PORT_NAMES } from "@/lib/masters/geo-names";
import { createPort, updatePort, deletePort } from "@/lib/masters/port-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { PORT_TYPES, type Port, type PortInput, type PortType } from "@/lib/masters/port-types";
import type { Country } from "@/lib/masters/country-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  short_name: "",
  name: "",
  country_id: "",
  port_type: "" as "" | PortType,
  /* NOT A FIELD ON THIS FORM — see the note where the Sheet's fields end. It is
     in the form state only so `submit()` can hand the stored value back, since
     `updatePort` writes the whole record. */
  inactive: false,
};

/**
 * WIDTHS, NOT TWELFTHS (client 2026-09-08: the fields "stretch across the entire
 * width" — make them "strictly hug their text content"; Name ~140px, Country
 * ~115px, Type ~95px).
 *
 * Same move as the Country and Destination masters beside this one. All three
 * fields were `size="sm"` — 3 of 12, so on a `size="lg"` sheet capped at 1180px
 * each got ~280px, and a three-value enum had the width of a customer name.
 * A fraction cannot be made compact: shrinking the control inside a twelfth
 * leaves the CELL at its old width and the value floating in dead space (the
 * "surplus reads as a HOLE rather than as room" failure `FieldRow`'s own note
 * records). Leaving the fractional track is the only thing that works, which is
 * what `FieldRow` + `Field w=` is for.
 *
 *   one row — name 144 + country 112 + type 112, two 12px gaps = 392px, and the
 *   row simply ENDS there.
 *
 * **The sums-to-12 rule does not apply and is not being broken** — that rule is
 * about a fractional track where leftovers read as page padding. A content-width
 * row has no twelfths to leave over. Do not "settle" this row by widening a
 * field; the note that used to sit on the section below spent two revisions
 * doing exactly that arithmetic and was stale both times.
 *
 * THE FIVE WIDTHS ARE THE WHOLE VOCABULARY (`lib/ui/sizes.ts`): num 72 · range
 * 112 · code 144 · term 176 · name 288. The requested ~140 / ~115 / ~95 are
 * mapped onto the nearest of those rather than hand-written, because "a screen
 * measured against its own longest value" is the exact failure that file exists
 * to prevent — a `w-[95px]` here would be the sixth unnamed constant after the
 * four it was written to replace.
 *
 * `name` TRADES AGAINST THE VOCABULARY'S OWN TEST, deliberately rather than by
 * oversight. That test is "does the value have a hard maximum the schema
 * guarantees?" — `portInput.name` is free text and sets no ceiling, so strictly
 * it does not qualify. At `code` (144px, ~132px of text in a plain `Input`)
 * "JEBEL ALI FREE ZONE" scrolls inside the box; it did at 280px too, just later.
 * Narrowing it is the client's explicit instruction.
 *
 * `type` IS 112 AND NOT THE 95 ASKED FOR, and the 17px is bought rather than
 * sloppy. It renders as a `Combobox` (`Select` enhances whenever its options
 * parse), so the box is not all text — `AFFORDANCE_PAD` reserves a 32px trailing
 * slot for the chevron and the clear ✕:
 *
 *   112 − 10 (px-2.5 left) − 32 (pr-8) − 2 (borders) = 68px ≈ 8 characters
 *
 * "Sea/Air" is 7 and fits. At `num` (72px) that arithmetic leaves 28px — three
 * characters, so "Air" itself would sit against the ✕ and "Sea/Air" would clip.
 * `num` is the only vocabulary width below 112, so 112 is the narrowest this
 * field can be and still show its longest value.
 *
 * `country` is the same picker sum as Destination's: 68px of text, which holds
 * "GERMANY" and clips "UNITED ARAB EMIRATES" to an ellipsis. That degrades
 * honestly — `DataPicker` carries `text-ellipsis` and a `Tooltip` reveal, the
 * "an ellipsis is a promise that the rest is reachable" rule — but if it reads
 * badly in use, `code` (144) is a one-token change.
 */
const FIELD_W = {
  name: "code", //     144px — plain Input, no affordance slot; ~132px of text
  country: "range", // 112px — less the picker's 32px icon slot; see above
  port_type: "range", // 112px — narrowest that still shows "Sea/Air"; see above
} satisfies Record<string, FieldWidth>;

/**
 * HOW WIDE THE FORM IS — the DETAILS card AND the footer's buttons, from ONE
 * declaration (client 2026-09-08: "reduce the outer DETAILS container to
 * max-width: 480px, and right-align the Cancel and Save buttons to this card").
 *
 * Narrowing the FIELDS does not narrow the CARD. `DetailSection` is a block box,
 * so it would still fill the sheet's 1180px while its content stopped at 392px —
 * which is why the cap belongs here and not in more work on the fields.
 *
 * 480px IS THE CLIENT'S NUMBER AND IS WIDER THAN THE CONTENT NEEDS. The row is
 * 144 + 112 + 112 + two 12px gaps = 392px, and the card adds its own
 * `@2xl/editor:p-2` and border: 392 + 16 + 2 = 410px to hug exactly. So ~70px
 * inside the card's right edge is empty by instruction — the same trade
 * Destination records against its own 380px, and the opposite of Country, whose
 * 29rem is derived from its row. Tighten to `max-w-[26rem]` (416px) if that gap
 * reads as the same "extra empty space" the fields were just narrowed to remove.
 *
 * BOTH READERS TAKE THIS SAME STRING, which is the only reason the buttons line
 * up with the card's right edge rather than approximately so. Change the number
 * here and the card and the footer move together; hand a second copy to either
 * one and they drift the first time a field width changes.
 */
const FORM_W = "max-w-[30rem]";

/**
 * Legacy "Port" master (Associates): Short Name · Name · Country (req, via the
 * ⓘ CountryPicker with Add/Modify) · Type (Air/Sea/Sea-Air).
 */
export function PortMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Port[];
  countries: Country[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  /* Active / Inactive from the listing's Status switch. `port` is registered in
     `lib/masters/active-registry.ts` (0547 is the migration that gave `ports`
     the column); `setStatus` does the write, the toast and the refresh, so this
     screen never touches the flag itself. */
  const { setStatus, isPending: statusPending } = useBlockAction("port");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Scoped by country, because a port name is only unique WITHIN one — there is
   * a Victoria in Canada, Hong Kong and the Seychelles, and refusing the second
   * would be wrong. `rowInScope` mirrors the server `scope` against the rows
   * already on screen so the synchronous half narrows the same way.
   *
   * Gated on a country being picked: unscoped, the check would be asking a
   * different question than the one the save guard answers. Save already
   * requires the country, so nothing is lost by waiting for it.
   *
   * Checks `name`, the box the operator types; `short_name` is derived from it
   * on create (see submit) and preserved on edit.
   */
  const dupError = useDuplicateName({
    table: "ports",
    name: form.name,
    scope: { country_id: form.country_id || null },
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim() && !!form.country_id,
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
    rowInScope: (r) => (r.country_id ?? "") === (form.country_id ?? ""),
  });

  // "Did you mean TUTICORIN?" — a misspelled port is the expensive typo here:
  // it splits every Customer's port of loading across two rows that mean the
  // same berth. Vocabulary is the ports already saved plus the curated export
  // list, and it is NOT scoped to the selected country (the Name is usually
  // typed before the country is picked, and nothing is auto-applied).
  //
  // Exact matches are skipped by design — this hint is for NEAR misses. The
  // exact case is `dupError` above, which now covers it (it did not when this
  // comment was first written, and a duplicated port name saved silently).
  const nameSuggest = useSpellSuggest({
    name: form.name,
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? ""),
    seed: PORT_NAMES,
    enabled: open,
    // Enter applies the highlighted chip; see the hook.
    onApply: (v) => set({ name: v }),
  });

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Port) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      name: r.name ?? "",
      country_id: r.country_id,
      port_type: r.port_type ?? "",
      // Carried, never typed — see BLANK.
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: PortInput = {
        // Create derives the short name from the display name; edit keeps the
        // record's original stored short name (held in state, never rendered).
        short_name: editId ? form.short_name.trim() || null : form.name.trim() || null,
        // Mandatory in the schema — see port-types.ts.
        name: form.name.trim(),
        country_id: form.country_id,
        port_type: form.port_type ? form.port_type : null,
        // `updatePort` writes the WHOLE record and `portInput.inactive` defaults
        // to false, so omitting this would switch a blocked port back on every
        // time somebody corrected its spelling.
        inactive: form.inactive,
      };
      const res = editId ? await updatePort(editId, payload) : await createPort(payload);
      if (res.ok) {
        success(editId ? "Port updated." : "Port added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Port) {
    startTransition(async () => {
      const res = await deletePort(r.id);
      if (res.ok) {
        // NOT "Port deleted." — since 0547 a referenced port is switched off
        // instead of removed (`deleteOrDeactivate`), and the toast is the only
        // thing that tells the operator which of the two they got.
        success(deletedToast("Port", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function countryName(r: Port): string {
    return r.country?.name ?? countryLabel.get(r.country_id) ?? "—";
  }

  /* The read-only view sheet and the mobile card want a pill rather than the
     listing's live switch — looking at a record must not be able to change it,
     which is why the shell renders `statusOf` there instead of the Status cell. */
  function statusPill(r: Port) {
    return r.inactive ? (
      <StatusPill tone="danger">Inactive</StatusPill>
    ) : (
      <StatusPill tone="success">Active</StatusPill>
    );
  }

  /* DATA COLUMNS ONLY. The trailing ⋮ cell, the Created pair and the Status
     column of switches are all spliced in by `MasterListShell` — declaring a
     `Status` header here would be STRIPPED as a duplicate (see
     `actions.onStatusChange`), and a hand-rolled actions column is what the
     shell exists to stop 131 listings from each writing differently. */
  const columns: Column<Port>[] = [
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name ?? "—"}</span> },
    { header: "Country", cell: (r) => <span className="text-sm">{countryName(r)}</span> },
    {
      header: "Type",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.port_type ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* THE WHOLE LISTING IS THE SHELL NOW — toolbar, search, Status facet,
          desktop table, mobile cards and pagination. This screen hand-rolled all
          five, which is why it was the one Associates master with no Status
          facet, no pagination and no read-only view; it also means the ⋮ actions
          menu and the Status switch arrive as props rather than as a second copy
          of two components whose own files say the shell is their only wiring
          path. */}
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.short_name, r.name, countryName(r), r.port_type].filter(Boolean).join(" ")
        }
        searchPlaceholder="Search port…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Port"
        onAdd={openAdd}
        columns={columns}
        rowLabel={(r) => r.name ?? r.short_name ?? "Port"}
        actions={{
          onEdit: openEdit,
          onDelete: remove,
          /* One ⋮ per row instead of three inline icons: View, Edit, a rule,
             then Delete behind a confirm dialog. */
          variant: "menu",
          /* Gives the list its Status column of switches, and is what the switch
             calls. `active` is stated positively; nothing here flips the boolean
             — `setStatus` does the write, the toast and the refresh. */
          onStatusChange: (r, active) => setStatus(r, active, { label: r.name }),
        }}
        empty="No port records yet."
        mobile={{
          title: (r) => r.name ?? r.short_name ?? "—",
          meta: (r) => [countryName(r), r.port_type].filter(Boolean).join(" · ") || null,
          pill: (r) => statusPill(r),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending || statusPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Port" : "New Port"}
        footer={
          /* `mr-auto` inside the Sheet footer's own `justify-end` row: the auto
             margin eats the free space on the RIGHT, so this box sits at the left
             edge and the buttons — right-aligned within it by `justify-end` — end
             exactly where the card above them ends. Without it they stay pinned to
             the 1180px pane and float a screen-width away from a 480px form.
             `FORM_W` is the same string the card takes. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !!dupError || !form.country_id || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* Three fields — one flat section (LAYOUT.md §4), and the whole form is
            one row. `cols={1}` because the fields are NOT on the twelfths track
            any more: the `FieldRow` below is a content-width flex row and the
            section just holds it. Widths come from FIELD_W at the top of this
            file, which also carries the row arithmetic.

            THE TWELFTHS ARITHMETIC THAT USED TO LIVE HERE WAS WRONG TWICE. It
            read `name 6 + country 3 + type 3 = 12` while Name was `lg`, stayed
            put when the one-width-across-the-module decision took Name to `sm`,
            and so claimed a full row when a quarter of it was free; correcting
            it to 3+3+3 = 9 on 2026-09-08 lasted until later the same day, when
            the row stopped being fractional at all. A sum in a comment is the
            one thing anyone re-reads before changing a width, and this one has
            now been stale in both directions — which is the argument for the
            widths being named constants the row is derived FROM. */}
        <DetailSection label="Details" cols={1} className={FORM_W}>
          {/* The three controls, one row, ending where the content ends.
              `FIELD_ROW` brings `gap-x-3` (12px) and `items-end` — the controls
              align on their BOTTOM edge, so a label that wraps inside a narrow
              cell pushes itself up rather than pushing its input a line down.
              That is what keeps the three boxes on one line. */}
          <FieldRow>
            <Field label="Name" w={FIELD_W.name} required htmlFor="pt-name">
              <Input
                id="pt-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                required
                {...dupFieldProps(dupError, "pt-name")}
              />
              <DuplicateError error={dupError} id="pt-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => set({ name: v })}
              />
            </Field>
            {/* No `label` on the Field: CountryPicker renders its own, and two
                labels misalign the asterisk and break click-to-focus. */}
            <Field w={FIELD_W.country}>
              <CountryPicker
                countries={countries}
                value={form.country_id || null}
                onChange={(id) => set({ country_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                // `portInput.country_id` is a bare `.uuid()` — mandatory. This
                // already held (CountryPicker defaults `required` to true); stating
                // it changes nothing at runtime and everything about whether the
                // screen can be SEEN to be correct. Destination looked balanced
                // for the same reason and had its `*` on the wrong field.
                required
              />
            </Field>
            {/* Air · Sea · Sea/Air — `range`, the narrowest width in the
                vocabulary that still shows "Sea/Air" past the clear ✕. See
                FIELD_W for the arithmetic. */}
            <Field label="Type" w={FIELD_W.port_type} htmlFor="pt-type">
              <Select
                id="pt-type"
                value={form.port_type}
                onChange={(e) => set({ port_type: e.target.value as "" | PortType })}
              >
                <option value=""></option>
                {PORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          {/* NO INACTIVE SWITCH HERE, AND THERE NEVER WAS ONE (client 2026-08-17:
              "block option move to that table listing … no more in the creating
              screen"). The flag arrived on `ports` with 0547 and went straight to
              the listing's Status column, so this form skips the step Country and
              Customer had to take of removing a field.

              `form.inactive` still round-trips through `submit()` — see BLANK —
              so editing a blocked port's name does not quietly switch it back on. */}
        </DetailSection>
      </Sheet>
    </div>
  );
}
