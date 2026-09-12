"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { StatusToggle } from "@/components/ui/status-toggle";
import {
  rowActionsColumn,
  ROW_ACTIONS_MENU_WIDTH,
} from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { isInactive } from "@/lib/masters/inactive";
import { useBlockAction } from "@/components/masters/use-block-action";
import { useToast } from "@/components/ui/toast";
import {
  createDestination,
  updateDestination,
  deleteDestination,
} from "@/lib/masters/destination-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import type { Destination, DestinationInput } from "@/lib/masters/destination-types";
import type { Country } from "@/lib/masters/country-types";
import { CountryPicker } from "@/components/masters/country-picker";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { COUNTRY_NAMES } from "@/lib/masters/geo-names";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = { short_name: "", country_id: "", name: "", inactive: false };

/**
 * WIDTHS, NOT TWELFTHS (client 2026-09-08: tighten Name to ~135px and Country
 * to ~115px, "removing all extra empty horizontal space inside both boxes").
 *
 * Same move as the Country master beside this one: `size="sm"` is 3 of 12, so on
 * a `size="lg"` sheet capped at 1180px both fields were ~280px. Shrinking a
 * control inside a twelfth leaves the CELL at its old width and the value
 * floating in dead space, so the fractional track has to be left entirely —
 * `FieldRow` + `Field w=` is what does that.
 *
 * Mapped onto the five-width vocabulary (`lib/ui/sizes.ts`: num 72 · range 112 ·
 * code 144 · term 176 · name 288) rather than hand-written, because "a screen
 * measured against its own longest value" is the failure that file exists to
 * prevent.
 *
 * BOTH OF THESE TRADE AGAINST THE VOCABULARY'S OWN TEST, which is "does the
 * value have a hard maximum the schema guarantees?" — a destination name and a
 * country name are both free text, so strictly neither qualifies. Narrowing them
 * is the client's explicit instruction and is recorded here as such, not as an
 * oversight.
 *
 * `country` IS THE TIGHT ONE, and the reason is not obvious from its width.
 * `DataPicker` reserves a 32px trailing slot for its affordance icon
 * (`AFFORDANCE_PAD` = `pr-8`), so a 112px cell is NOT 112px of text:
 *
 *   112 − 10 (px-2.5 left) − 32 (pr-8) − 2 (borders) = 68px ≈ 8 characters
 *
 * "GERMANY" fits; "UNITED ARAB EMIRATES" does not, and clips to an ellipsis.
 * That degrades honestly rather than silently — the picker carries `text-ellipsis`
 * and a `Tooltip` reveal, which is the "an ellipsis is a promise that the rest is
 * reachable" rule — but if the truncation reads badly in use, `code` (144px, ~100px
 * of text) is a one-token change. A plain `Input` has no such slot, so `name` at
 * `code` really does get ~132px of text.
 */
const FIELD_W = {
  name: "code", //     144px — plain Input, no affordance slot
  country: "range", // 112px — less the picker's 32px icon slot; see above
} satisfies Record<string, FieldWidth>;

/**
 * HOW WIDE THE FORM IS — the DETAILS card AND the footer's buttons, from ONE
 * declaration, so the buttons end exactly where the card does rather than
 * approximately (client 2026-09-08: "align the Cancel/Save buttons to match this
 * width", then "resize the main card container to match" the narrowed fields).
 *
 * DERIVED, NOT PICKED — the same sum the sibling Country master writes out, and
 * for the same reason: narrowing the FIELDS does not narrow the CARD, because
 * `DetailSection` is a block box and goes on filling the sheet's 1180px while
 * its content stops short. The row is the two widths plus the one 12px gap
 * `FIELD_ROW` puts between them:
 *
 *   144 + 112           = 256   the controls (FIELD_W above)
 *   + 1 × 12            =  12   gap-x-3
 *   = 268                       the content row
 *   + 2 × 8             =  16   the card's own `@2xl/editor:p-2`
 *   + 2 × 1             =   2   its border
 *   = 286                       the card, hugging exactly
 *
 * 18.5rem (296px) leaves 10px of slack over that, deliberately and for the
 * reason the Country master records: at the NON-compact density the padding is
 * `p-2.5` rather than `p-2`, costing 4px more, and `FIELD_ROW` is `flex-wrap` —
 * so a cap that hugs at one density drops Country onto a second line at the
 * other. Slack is invisible; a wrap is not.
 *
 * THIS SUPERSEDES AN EARLIER 380px, which was a number the client gave for this
 * card BEFORE the fields beneath it were narrowed. At 380 the row ended 94px
 * inside the card's right edge — the same "extra empty space" the field
 * narrowing was asked for, one box out. Do not restore it as a correction.
 *
 * BOTH READERS TAKE THIS SAME STRING, which is the only reason the buttons line
 * up with the card's right edge rather than approximately so. Change the number
 * here and the card and the footer move together; hand a second copy to either
 * one and they drift the first time a field width changes.
 */
const FORM_W = "max-w-[18.5rem]";

/**
 * Legacy "Destination" master (Associates). Short Name · Country (required,
 * via the ⓘ CountryPicker with Add/Modify) · Name · Inactive.
 */
export function DestinationMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Destination[];
  countries: Country[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  /* The Status SWITCH in the listing (client 2026-09-11). `setStatus` does the
     write, the toast and the refresh; `destination` is registered in
     `lib/masters/active-registry.ts`. */
  const { setStatus, isPending: statusPending } = useBlockAction("destination");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  // Real-time duplicate check on Name, per country — mirrors the DB's unique
  // index on (country_id, lower(trim(short_name))) (0335); creates derive
  // short_name from Name, so a clash would otherwise surface as a raw
  // constraint error on save.
  const dupError = useDuplicateName({
    table: "destinations",
    name: form.name,
    nameColumn: "short_name",
    scope: { country_id: form.country_id || null },
    excludeId: editId ?? undefined,
    enabled: !!(form.name.trim() && form.country_id),
    // The synchronous half. `rowValue` follows `nameColumn`, not the label —
    // this master's identity is the short name, within one country.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.short_name,
    rowInScope: (r) => r.country_id === form.country_id,
  });

  // "Did you mean…?" on Name. The vocabulary is the destinations already saved
  // PLUS country names — a final destination in this trade is overwhelmingly a
  // country, and `countries` is already on this screen for the picker, so that
  // half of the dictionary costs nothing to maintain. Deliberately NOT scoped
  // to the selected country: the operator usually types the Name before picking
  // one, and a hint that misses is free to ignore — nothing is auto-applied.
  const nameSuggest = useSpellSuggest({
    name: form.name,
    names: [
      ...rows.filter((r) => r.id !== editId).map((r) => r.name ?? ""),
      ...countries.map((c) => c.name),
    ],
    seed: COUNTRY_NAMES,
    enabled: open,
    // Enter applies the highlighted chip; see the hook.
    onApply: (v) => set({ name: v }),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.short_name, countryLabel.get(r.country_id)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, countryLabel]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Destination) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name ?? "",
      country_id: r.country_id,
      name: r.name ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: DestinationInput = {
        // Create derives the short name from the display name; edit keeps the
        // record's original stored short name (held in state, never rendered).
        short_name: editId ? form.short_name.trim() || null : form.name.trim() || null,
        country_id: form.country_id,
        // Mandatory in the schema — see destination-types.ts.
        name: form.name.trim(),
        inactive: form.inactive,
      };
      const res = editId ? await updateDestination(editId, payload) : await createDestination(payload);
      if (res.ok) {
        success(editId ? "Destination updated." : "Destination added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Destination) {
    startTransition(async () => {
      const res = await deleteDestination(r.id);
      if (res.ok) {
        success(deletedToast("Destination", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Destination>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    {
      header: "Country",
      cell: (r) => <span className="text-sm text-muted-foreground">{countryLabel.get(r.country_id) ?? "—"}</span>,
    },
    {
      /* A SWITCH, NOT A PILL (client 2026-09-11) — one click calls the status
         API, with no editor in between. Same component as Country, Port and
         Bank, so the four cannot drift.

         This screen builds its own `DataTable` rather than going through
         `MasterListShell`, so the cell is declared here instead of being spliced
         in. That is the ONLY difference: the switch, its green, the word beside
         it and the `isInactive` read are all `StatusToggle`'s. */
      header: "Status",
      className: "w-32",
      cell: (r) => (
        <StatusToggle
          row={r}
          label={r.name}
          // Blocking is the destructive direction and `setMasterActive` gates it
          // as `delete` server-side.
          disabled={!perms.canDelete || isPending || statusPending}
          onChange={(active) => setStatus(r, active, { label: r.name ?? undefined })}
        />
      ),
    },
    rowActionsColumn(
      (r) => (
        /* One ⋮ per row instead of three inline icons: View, Edit, a rule, then
           Delete behind a confirm dialog. The View is automatic — `rowActionsColumn`
           publishes the row and the menu reads it, exactly as `RowActions` did
           here before, so the eye this screen already had is not lost. */
        <TableRowActionsMenu
          label={r.name}
          onEdit={() => openEdit(r)}
          onDelete={() => remove(r)}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
          isPending={isPending || statusPending}
        />
      ),
      ROW_ACTIONS_MENU_WIDTH,
    ),
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search destination…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Destination
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        {/* `rowClassName` dims a switched-off row's DATA cells and leaves the
            last one alone — the ⋮ must stay legible on a dimmed row, and
            `opacity` on the `<tr>` would take it down with the text. Same rule
            `MasterListShell` applies to the listings it owns. */}
        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(r) => r.id}
          rowClassName={(r) =>
            isInactive(r) ? "[&>td:not(:last-child)]:opacity-60" : undefined
          }
          empty="No destination records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No destination records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.name ?? r.short_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {countryLabel.get(r.country_id) ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
        title={editId ? "Edit Destination" : "New Destination"}
        footer={
          /* `mr-auto` inside the Sheet footer's own `justify-end` row: the auto
             margin eats the free space on the RIGHT, so this box sits at the left
             edge and the buttons — right-aligned within it — end exactly where the
             card above them ends. Without it they stay pinned to the 1180px pane,
             a screen-width away from a 296px form. Same string as the card. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.country_id || !form.name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* Two fields plus a flag — one flat section (LAYOUT.md §4). `cols={1}`
            because the fields no longer sit on the twelfths track: each
            `FieldRow` below is a content-width flex row and the section just
            stacks them. Widths come from FIELD_W at the top of this file. */}
        <DetailSection label="Details" cols={1} className={FORM_W}>
          {/* The two inputs, one row. `FIELD_ROW` brings `gap-x-3` (12px) and
              `items-end`, so the two controls sit on one line even if a label
              wraps inside its narrower cell. */}
          <FieldRow>
            <Field label="Name" w={FIELD_W.name} required htmlFor="de-name">
              <Input
                id="de-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                {...dupFieldProps(dupError, "de-name")}
              />
              <DuplicateError error={dupError} id="de-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => set({ name: v })}
              />
            </Field>
            {/* CountryPicker renders its own label — see the note on port. */}
            <Field w={FIELD_W.country}>
              <CountryPicker
                countries={countries}
                value={form.country_id || null}
                onChange={(id) => set({ country_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                // `destinationInput.country_id` has ALWAYS been mandatory, and the
                // file header has said "Country (required)" since it was written —
                // the picker just never carried the prop, so nothing held. It hid
                // behind the audit's count comparison too: one `required` declared
                // against one mandatory field looked balanced, while the
                // declaration sat on Name and the mandatory field was this one.
                required
              />
            </Field>
          </FieldRow>

          {/* NO INACTIVE SWITCH HERE ANY MORE (client 2026-08-17: "block option
              move to that table listing — we are used to give that block while
              CREATING the data but we need to move this in ACTION only, no more
              in the creating screen"). It is the listing's Status column now: a
              switch on the row, wired straight to `setStatus` above, with
              `destination` registered in `lib/masters/active-registry.ts`.

              **The row control had to land first** — it is the only route to the
              flag once the field is gone, so deleting the field on its own would
              have made blocking a destination impossible rather than moved it.
              Same order `customer-master-screen.tsx` followed on 2026-09-09 and
              `country-master-screen.tsx` on 2026-09-11.

              `form.inactive` is STILL in the form state and still round-trips
              through `submit()`, so editing a blocked destination does not
              quietly switch it back on. The value is simply no longer typed here.

              It was also the field that gave this section two shapes: edit-only,
              it left a hole on New and a lone switch on Edit. */}
        </DetailSection>
      </Sheet>
    </div>
  );
}
