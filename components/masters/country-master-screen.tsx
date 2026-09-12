"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useBlockAction } from "@/components/masters/use-block-action";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { COUNTRY_NAMES } from "@/lib/masters/geo-names";
import { createCountry, updateCountry, deleteCountry } from "@/lib/masters/country-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { COUNTRY_GROUPS, type Country, type CountryGroup, type CountryInput } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  code: "",
  name: "",
  country_group: "" as "" | CountryGroup,
  ecgc_code: "",
  isd_code: "",
  default_country: false,
  inactive: false,
};

/**
 * WIDTHS, NOT TWELFTHS (client 2026-09-08: the fields "stretch across the full
 * width with excessive empty space" — make them "tightly shrink-wrapped to fit
 * their text content").
 *
 * This form used to be `size="sm"` on all six fields — 3 of 12 each, four per
 * row. On a `size="lg"` sheet capped at 1180px that is ~280px PER FIELD, so a
 * two-character ISD code and a four-value enum each got the width of a customer
 * name. A fraction cannot be made compact: shrinking the control inside a
 * twelfth leaves the CELL at its old width and the value floating in dead space
 * (the "surplus reads as a HOLE rather than as room" failure `FieldRow`'s own
 * note records). Leaving the fractional track is the only thing that works,
 * which is what `FieldRow` + `Field w=` is for.
 *
 *   row 1 — name 144 + country_group 112 + ecgc 72 + isd 72, three 12px gaps
 *            = 436px, and the row simply ENDS there.
 *   row 2 — the Default Country switch at content width. (Inactive used to
 *            sit beside it; it is a row action now — see the note at that
 *            `FieldRow` below.)
 *
 * **The sums-to-12 rule does not apply and is not being broken** — that rule is
 * about a fractional track where leftovers read as page padding. A content-width
 * row has no twelfths to leave over. Do not "settle" this row by widening a
 * field.
 *
 * THE FIVE WIDTHS ARE THE WHOLE VOCABULARY (`lib/ui/sizes.ts`): num 72 · range
 * 112 · code 144 · term 176 · name 288. The requested ~135 / ~120 / ~85 / ~75
 * are mapped onto the nearest of those rather than hand-written, because "a
 * screen measured against its own longest value" is the exact failure that file
 * exists to prevent — and a `w-[135px]` here would be the sixth unnamed constant
 * after the four it was written to replace.
 *
 * `name` IS THE ONE THAT TRADES AGAINST THE RULE, and it is deliberate rather
 * than overlooked. `FieldWidth`'s test is "does the value have a hard maximum
 * the schema guarantees?" — `country_group` is a 4-value enum, `isd_code` is
 * `maxLength: 5`, and both qualify outright. A country NAME does not: it is free
 * text, and `countryInput.name` sets no ceiling. At `code` (144px, ~16
 * characters at 14px type) "UNITED ARAB EMIRATES" scrolls inside the box — it
 * did at 280px too, which is what the old comment here recorded, just sooner.
 * Bump this one to `term` (176) or `name` (288) if that reads badly in use; the
 * other three are sound at any width the vocabulary offers.
 */
const FIELD_W = {
  name: "code", //          144px — free text; see the note above
  country_group: "range", // 112px — EU · USA · CANADA · OTHERS
  ecgc_code: "num", //        72px
  isd_code: "num", //         72px — format="isd", maxLength 5 ("+91")
} satisfies Record<string, FieldWidth>;

/**
 * HOW WIDE THE FORM IS — the DETAILS card AND the footer's buttons, from ONE
 * declaration (client 2026-09-08: the card "stretches to full 100% width leaving
 * half of the right side completely empty"; end it after ISD Code and "align the
 * action buttons accordingly").
 *
 * Narrowing the FIELDS did not narrow the CARD. `DetailSection` is a block box,
 * so it still filled the sheet's 1180px while its content stopped at 436px —
 * which is why the fix is a width on the card and not more work on the fields.
 *
 * DERIVED, NOT PICKED. The row is the four widths plus the three 12px gaps
 * `FIELD_ROW` puts between them:
 *
 *   144 + 112 + 72 + 72  = 400   the controls (FIELD_W above)
 *   + 3 × 12             =  36   gap-x-3
 *   = 436                        the content row
 *   + 2 × 8              =  16   the card's own `@2xl/editor:p-2`
 *   + 2 × 1              =   2   its border
 *   = 454                        the card, hugging exactly
 *
 * 29rem (464px) leaves 10px of slack over that, deliberately: at the NON-compact
 * density the card's padding is `p-2.5` rather than `p-2`, which costs 4px more,
 * and a cap that fits only at one density would wrap the row into two lines at
 * the other. Slack is invisible; a wrap is not.
 *
 * BOTH READERS TAKE THIS SAME STRING, which is the only reason the buttons line
 * up with the card's right edge rather than approximately so. Change the number
 * here and the card and the footer move together; hand a second copy to either
 * one and they drift the first time a field width changes.
 */
const FORM_W = "max-w-[29rem]";

/**
 * The stored `code` for a NEW country, derived from its name.
 *
 * It used to be the trimmed name and nothing more, so two countries typed the
 * same way carried the same code as well as the same name. The name is now
 * unique at all three layers (`uq_countries_name`, migration 0373), but a code
 * an operator typed by hand in the picker's Add sheet can still sit on the one
 * a later name would derive — so suffix `-2`, `-3` … until the code is free
 * among the rows we hold.
 *
 * Best-effort by construction: it can only see the rows on this page, and the
 * name index is what actually makes two identical countries impossible.
 */
function deriveCode(name: string, existing: Country[]): string | null {
  const base = name.trim();
  if (!base) return null;
  const taken = new Set(
    existing.map((c) => (c.code ?? "").trim().toUpperCase()).filter(Boolean),
  );
  if (!taken.has(base.toUpperCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate.toUpperCase())) return candidate;
  }
  return base;
}

/**
 * Legacy "Country" master (Associates). Flat form with a Country Group enum and
 * Save / Save-As-Drafts — the draft button persists with `is_draft = true`.
 * List chrome via MasterListShell (search + status facet + pagination + mobile
 * delete + two-step delete + ?new=1 create intent).
 */
export function CountryMasterScreen({ rows, perms }: { rows: Country[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  /* Active / Inactive in the row's ⋮ menu. `country` is registered in
     `lib/masters/active-registry.ts`; `setStatus` does the write, the toast and
     the refresh, so this screen never touches the flag itself. */
  const { setStatus, isPending: statusPending } = useBlockAction("country");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  // Told as they type, not on Save. `excludeId` stops an edit reporting the
  // record as colliding with itself; `enabled` keeps the round trip off the
  // keystroke while the sheet is closed. Unscoped, matching the on-save guard
  // in country-actions.ts and `uq_countries_name` — a DEACTIVATED country
  // keeps its name reserved.
  const dupError = useDuplicateName({
    table: "countries",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: open,
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  // "Did you mean GERMANY?" — the duplicate check above only fires on an EXACT
  // collision, so GERMNY sails past it and becomes a second country nobody
  // meant to create. Suppressed while dupError is showing: one line under the
  // input, and the red error is the more urgent of the two.
  const nameSuggest = useSpellSuggest({
    name: form.name,
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name),
    seed: COUNTRY_NAMES,
    enabled: open,
    // Enter applies the highlighted chip; see the hook.
    onApply: (v) => set({ name: v }),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Country) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      country_group: r.country_group ?? "",
      ecgc_code: r.ecgc_code ?? "",
      isd_code: r.isd_code ?? "",
      default_country: r.default_country,
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    if (dupError) return; // the server rejects it too; don't spend the round trip
    startTransition(async () => {
      const payload: CountryInput = {
        // Create derives the code from Name (deduped — see deriveCode); edit
        // keeps the record's original stored code (it can be a logic key
        // referenced elsewhere).
        code: editId ? form.code || null : deriveCode(form.name, rows),
        name: form.name.trim(),
        country_group: form.country_group ? form.country_group : null,
        ecgc_code: form.ecgc_code.trim() || null,
        isd_code: form.isd_code.trim() || null,
        default_country: form.default_country,
        inactive: form.inactive,
        is_draft: asDraft,
      };
      const res = editId ? await updateCountry(editId, payload) : await createCountry(payload);
      if (res.ok) {
        success(editId ? "Country updated." : asDraft ? "Saved as draft." : "Country added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Country) {
    startTransition(async () => {
      const res = await deleteCountry(r.id);
      if (res.ok) {
        success(deletedToast("Country", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: Country) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.inactive) return <StatusPill tone="danger">Inactive</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<Country>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Group", cell: (r) => <span className="text-sm text-muted-foreground">{r.country_group ?? "—"}</span> },
    { header: "ISD", cell: (r) => <span className="text-sm text-muted-foreground">{r.isd_code ?? "—"}</span> },
    {
      header: "Default",
      cell: (r) => (r.default_country ? <span className="text-sm text-primary">✓</span> : <span className="text-sm text-muted-foreground">—</span>),
    },
    /* NO Status COLUMN DECLARED HERE, AND THE COLUMN IS STILL THERE.
       `MasterListShell` splices it in because this screen passes
       `onStatusChange` — a switch plus the word it is set to, clicking which
       calls the status API directly (client 2026-09-11). Declaring one here
       would be stripped as a duplicate; see that prop.

       Draft is the one state a two-position switch cannot express: `is_draft`
       is orthogonal to `inactive`, so a draft country shows an ON switch reading
       "Active". It stays legible in the Status FACET above the list, in the
       mobile card's pill, and in the view sheet, which renders `statusOf` rather
       than the switch. */
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.code, r.name, r.country_group, r.isd_code, r.ecgc_code].filter(Boolean).join(" ")
        }
        searchPlaceholder="Search country…"
        statusOf={(r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active")}
        addLabel="+ Add Country"
        onAdd={openAdd}
        columns={columns}
        actions={{
          onEdit: openEdit,
          onDelete: remove,
          /* One ⋮ per row instead of three inline icons: View, Edit, a rule,
             then Delete behind a confirm dialog. */
          variant: "menu",
          /* Gives the list its Status column of switches, and is what the
             switch calls. `active` is stated positively; nothing here flips the
             boolean — `setStatus` does the write, the toast and the refresh. */
          onStatusChange: (r, active) => setStatus(r, active, { label: r.name }),
        }}
        empty="No country records yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            [r.country_group, r.isd_code ? `+${r.isd_code}` : null].filter(Boolean).join(" · ") || null,
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
        title={editId ? "Edit Country" : "New Country"}
        footer={
          /* `mr-auto` inside the Sheet footer's `justify-end` row: the auto
             margin eats the free space on the RIGHT, so this box sits at the
             left edge and the buttons — right-aligned inside it by `justify-end`
             — end exactly where the card above them ends. Without it they stay
             pinned to the 1180px pane and float a screen-width away from a
             464px form. `FORM_W` is the same string the card takes. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.name.trim() || !!dupError}
              onClick={() => submit(false)}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* Six fields — under the 7 that would call for grouping (LAYOUT.md §4),
            so one flat section. `cols={1}` because the fields are NOT laid out
            on the twelfths track any more: each `FieldRow` below is a
            content-width flex row, and the section just stacks the two of them.
            Widths come from FIELD_W at the top of this file. */}
        <DetailSection label="Details" cols={1} className={FORM_W}>
          {/* The four inputs, one row, ending where the content ends.
              `FIELD_ROW` brings `gap-x-3` (12px) and `items-end` — the controls
              align on their BOTTOM edge, so a label that wraps inside a narrow
              cell pushes itself up rather than pushing its input a line down.
              That is what keeps the four boxes on one line. */}
          <FieldRow>
            <Field label="Name" w={FIELD_W.name} required htmlFor="co-name">
              <Input
                id="co-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                required
                {...dupFieldProps(dupError, "co-name")}
              />
              <DuplicateError error={dupError} id="co-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => set({ name: v })}
              />
            </Field>
            <Field label="Country Group" w={FIELD_W.country_group} htmlFor="co-group">
              <Select
                id="co-group"
                value={form.country_group}
                onChange={(e) => set({ country_group: e.target.value as "" | CountryGroup })}
              >
                <option value=""></option>
                {COUNTRY_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ECGC Code" w={FIELD_W.ecgc_code} htmlFor="co-ecgc">
              <Input
                uppercase
                id="co-ecgc"
                value={form.ecgc_code}
                onChange={(e) => set({ ecgc_code: e.target.value })}
              />
            </Field>
            <Field label="ISD Code" w={FIELD_W.isd_code} htmlFor="co-isd">
              <ValidatedInput
                id="co-isd"
                format="isd"
                value={form.isd_code}
                onChange={(e) => set({ isd_code: e.target.value })}
              />
            </Field>
          </FieldRow>

          {/* The flags get their OWN row, below the inputs and at content width.
              They are deliberately not in the row above: `FIELD_ROW` is
              `items-end` and a switch carries no label row, so sharing the row
              would bottom-align them against the 46px fields and leave them
              floating beside the boxes. A second row is what keeps both tight.

              `Toggle`, NOT A TICK BOX (client 2026-09-08: the same switch Order
              Entry uses). Size, track colour and the ON `--primary` are the
              component's, not this screen's — which is the point of asking for
              "the same as Order Entry": Garment Order's Pack / Multi Style
              switches render from this same file, so they cannot drift apart.

              IT IS STILL A REAL CHECKBOX UNDERNEATH, and that is what makes the
              swap safe rather than merely pretty. `Toggle` keeps an `sr-only`
              `<input type="checkbox">` and draws the switch with its siblings,
              because `isFieldLike()` (lib/focus.ts) counts an `<input>` and NOT
              a `<button role="switch">` — the obvious build would have dropped
              both flags off Tab, off Enter-advance and off the arrows, leaving
              them mouse-only. Tab reaches them, Enter and Space toggle them, and
              a screen reader still announces a checkbox. */}
          <FieldRow>
            <Toggle
              id="co-default"
              label="Default Country"
              checked={form.default_country}
              onChange={(default_country) => set({ default_country })}
            />
            {/* NO INACTIVE SWITCH HERE ANY MORE (client 2026-08-17: "block
                option move to that table listing — we are used to give that
                block while CREATING the data but we need to move this in ACTION
                only, no more in the creating screen"). It is the listing's ⋮
                menu's Active / Inactive pair now, wired at `onStatusChange`
                above, with `country` already registered in
                `lib/masters/active-registry.ts`.

                **The row action had to land first** — it is the only route to
                the flag once the field is gone, so deleting the field on its own
                would have made blocking a country impossible rather than moved
                it. That is the order `customer-master-screen.tsx` followed on
                2026-09-09 and `bank-master-screen.tsx` before it.

                `form.inactive` is STILL in the form state and still round-trips
                through `submit()`, so editing a blocked country does not quietly
                switch it back on. The value is simply no longer typed here.

                It was also the field that gave this row two shapes: unlabelled
                and edit-only, it left a hole on New and a floating switch on
                Edit. */}
          </FieldRow>
        </DetailSection>
      </Sheet>
    </div>
  );
}
