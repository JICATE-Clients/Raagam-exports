"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { StatusToggle } from "@/components/ui/status-toggle";
import {
  rowActionsColumn,
  ROW_ACTIONS_MENU_WIDTH,
} from "@/components/ui/row-actions-column";
import { isInactive } from "@/lib/masters/inactive";
import { useBlockAction } from "@/components/masters/use-block-action";
import { deletedToast } from "@/lib/masters/delete-message";
import { DetailSection } from "@/components/masters/detail-section";
import {
  createOurBank,
  updateOurBank,
  deleteOurBank,
} from "@/lib/masters/our-bank-actions";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import type { OurBank, OurBankInput } from "@/lib/masters/our-bank-types";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = { account_no: "", account_name: "", bank_name: "", branch_name: "", swift_code: "", ifsc_code: "", address: "", inactive: false };

/**
 * OUR BANK — ONE ROW, NEVER FOLDED (`erp-form-compact`; client 2026-09-10:
 * every DETAILS field "into a single, compact horizontal row … so nothing
 * drops to a second row").
 *
 * Eight fields at `size="sm"` was 3 of 12 each, and a `Sheet` is
 * `max-w-[1180px]` — so an ELEVEN-CHARACTER IFSC stood in a ~275px box, and so
 * did the SWIFT beside it, and so did every name on the form. A fraction cannot
 * be made compact: narrowing the control inside a twelfth leaves the CELL at its
 * old width and the value floating in it. So `FieldRow` + `Field w=`.
 *
 * THE ROW IS NOW THE CONSTRAINT, AND IT REVERSES THIS FILE'S OWN PREVIOUS RULE.
 * The version before this one put the eight fields on three wrapping lines and
 * argued at length that the four unbounded ones "STAY AT 288 AND THAT IS THE
 * POINT" — `FieldWidth`'s test is whether the schema guarantees a maximum, and a
 * bank's name has none. That test still says 288. What changed is that a single
 * line is no longer a preference the widths can outvote: eight cells have to fit
 * one pane, so the widths are DERIVED FROM THE PANE and the four names take the
 * step below.
 *
 * The ceiling is arithmetic, not judgement. At `code` (144) the four names make
 * the row 1206px inside a 1164px box (1180 minus `DetailSection`'s own `p-2`) —
 * it does not fit at ANY gap, so `code` was never available here and there was
 * nothing to weigh:
 *
 *   term  176   Account No — `maxLength: 18` (`lib/validation/formats.ts`), the
 *               widest bounded value on the form at ~151px of digits. `code`
 *               holds about fourteen of them, so this is the floor rather than a
 *               choice, and it is why the row's slack cannot be spent here.
 *   code  144   Swift, IFSC — `maxLength: 11` both, ~99px of glyphs plus the
 *               box's own padding, so `range` would clip the eleventh character.
 *   range 112   Bank Name, Address.
 *   hug    88   Account Name, Branch Name — TIGHTER STILL, and as tight as either
 *               can go (client 2026-09-10, "compact", set to the text).
 *
 * `hug` IS THE LABEL'S FLOOR, NOT THE VALUE'S. It is the seventh vocabulary step
 * and it was added for this row; its note in `lib/ui/sizes.ts` carries the
 * measurement, taken from the Inter this app actually ships rather than
 * estimated. "Account Name" is 85.9px of Inter 600 at 12px, so 88px is the last
 * width at which the label still fits on one line — and `align="start"` below is
 * what makes that a hard floor rather than a nicety: a label wrapping to two
 * lines drops its own control a line under the other seven. `num` (72px) is the
 * step below and would do exactly that, silently.
 *
 * SO THE ROW NOW CARRIES TWO WIDTHS FOR FREE TEXT, and the version before this
 * one argued at length that it should carry one — "ALL FOUR UNBOUNDED FIELDS TAKE
 * THE SAME STEP", with the 92px of slack deliberately left unspent so that no
 * per-field ladder could start. The client named two of the four, so the ladder
 * is theirs and it is one rung. What the old note was guarding is still guarded,
 * because 88 is not a measurement of what Account Names happen to be in this
 * database — it is the same floor any two-word label on any screen has, which is
 * why it went into the vocabulary instead of into a `w-[88px]` here.
 *
 * NO HAND-TYPED PIXELS. Every value is a step of the vocabulary; `party` (200) is
 * not one of them here, because its own note in `lib/ui/sizes.ts` reserves it for
 * a short proper noun that `term` clips, and nothing on this row is being widened.
 *
 * WHAT THE NARROW BOXES COST, said plainly: at 88px about eight characters of
 * "STATE BANK OF INDIA" are visible, so it scrolls inside its own input while
 * being typed. That is the price of the single compact row the client asked for,
 * it is paid only by the four fields with no schema maximum, and it loses nothing
 * — an `<input>` scrolls its value rather than truncating it, so there is no
 * ellipsis here promising a reveal that does not exist (AGENTS.md, "Truncated
 * values").
 */
const OUR_BANK_W = {
  account_no: "term", //     18 digits, the schema's own maximum
  account_name: "hug", //    the label's floor: "Account Name" is 85.9px at 88
  bank_name: "range",
  branch_name: "hug", //     "Branch Name", 78.2px
  swift_code: "code", //     8 or 11 characters
  ifsc_code: "code", //      exactly 11
  address: "range",
} satisfies Record<string, FieldWidth>;

/**
 * HOW WIDE THE FORM IS (`erp-form-compact` rule 3) — the card AND the footer's
 * button box, from ONE declaration.
 *
 * Narrowing the fields does not narrow the CARD: `DetailSection` is a block box
 * and goes on filling the Sheet's 1180px whatever is inside it, and the footer
 * buttons stay pinned to that pane — so Save would sit most of a screen to the
 * right of the last field it saves. `country-master-screen.tsx` records this
 * pattern and both of its readers.
 *
 * DERIVED, NOT PICKED — the row, left to right, at the widths above:
 *
 *   176 + 88 + 112 + 88 + 144 + 144 + 112  =  864   the seven inputs
 *   6 x 8                                  =   48   `gap="pack"`, the 8px the
 *                                                   client asked for
 *   = 912                                           the row
 *   + 2 x 8                                =  928   `DetailSection`'s `p-2`
 *
 * 65rem (1040px) leaves 112px over that — the same slack-not-wrap trade
 * Country's and Zone's caps make: the buttons must not be the thing that decides
 * where the row ends. It is 148px under the Sheet's own 1180px pane, which is
 * the number that had to clear and the reason `code` was unavailable for the
 * names above.
 *
 * EVERY TERM IN THAT SUM IS NOW A DECLARED STEP. The eighth cell used to be the
 * Inactive switch at ~96px, and it was the one estimate here — a switch carries
 * no `w`, so its width was its own word measured in Inter 400. It became a row
 * action on 2026-09-11 (see the note where it stood), so the row is seven cells
 * in BOTH states and New and Edit are finally the same shape. The cap is left at
 * 65rem rather than retightened: it is a ceiling, the row is left-aligned inside
 * it, and lowering it would only mean re-deriving this block the next time a
 * field is added.
 */
const FORM_W = "max-w-[65rem]";

export function OurBankMasterScreen({
  rows,
  perms,
}: {
  rows: OurBank[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  /* The Status SWITCH in the listing (client 2026-09-11). `setStatus` does the
     write, the toast and the refresh; `our_bank` is registered in
     `lib/masters/active-registry.ts`. */
  const { setStatus, isPending: statusPending } = useBlockAction("our_bank");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  // Real-time duplicate check on Account No — mirrors the on-save guard in
  // our-bank-actions (our_banks / account_no).
  //
  // spell-suggest: exempt -- the guarded field is an account number. A digit
  // string has no spelling, so every "did you mean?" it could produce would be a
  // different real account, offered next to the one the operator is typing. That
  // is the one place a wrong chip could move money.
  const dupError = useDuplicateName({
    table: "our_banks",
    name: form.account_no,
    nameColumn: "account_no",
    excludeId: editId ?? undefined,
    enabled: !!form.account_no.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.account_no,
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(rows, {
    searchKey: (r) => [r.account_name, r.bank_name, r.branch_name, r.account_no].filter(Boolean).join(" "),
    filters: {
      status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
    },
    initialFilters: { status: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: OurBank) {
    setEditId(r.id);
    setForm({
      account_no: r.account_no ?? "",
      account_name: r.account_name ?? "",
      bank_name: r.bank_name ?? "",
      branch_name: r.branch_name ?? "",
      swift_code: r.swift_code ?? "",
      ifsc_code: r.ifsc_code ?? "",
      address: r.address ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: OurBankInput = {
        // Mandatory in the schema — see our-bank-types.ts (`requiredKind`).
        account_no: form.account_no.trim(),
        account_name: form.account_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        branch_name: form.branch_name.trim() || null,
        swift_code: form.swift_code.trim() || null,
        ifsc_code: form.ifsc_code.trim() || null,
        address: form.address.trim() || null,
        inactive: form.inactive,
      };
      const res = editId ? await updateOurBank(editId, payload) : await createOurBank(payload);
      if (res.ok) {
        success(editId ? "Bank updated." : "Bank added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: OurBank) {
    startTransition(async () => {
      const res = await deleteOurBank(r.id);
      if (res.ok) {
        /* `deletedToast`, not a flat "Bank deleted." — `deleteOrDeactivate`
           decides delete-vs-deactivate server-side, so only the RESULT knows
           which happened. The old wording claimed a delete on every in-use bank,
           and it went unnoticed because that branch could not be reached: the
           action patched a `blocked` column dropped by 0305, so an in-use bank
           errored rather than soft-disabling (fixed in `our-bank-actions.ts`
           today). Fixing the write is what made the wrong toast reachable. */
        success(deletedToast("Bank", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<OurBank>[] = [
    { header: "Account No", cell: (r) => <span className="text-sm">{r.account_no ?? "—"}</span> },
    { header: "Account Name", cell: (r) => <span className="text-sm">{r.account_name ?? "—"}</span> },
    { header: "Bank Name", cell: (r) => <span className="text-sm">{r.bank_name ?? "—"}</span> },
    { header: "Branch", cell: (r) => <span className="text-sm">{r.branch_name ?? "—"}</span> },
    {
      /* A SWITCH, NOT A PILL (client 2026-09-11) — one click calls the status
         API, with no editor in between. Same component as Country, Port, Bank
         and Destination, so no two listings can drift.

         This screen builds its own `DataTable` rather than going through
         `MasterListShell`, so the cell is declared here instead of being spliced
         in. That is the ONLY difference: the switch, its green, the word beside
         it and the `isInactive` read are all `StatusToggle`'s. */
      header: "Status",
      className: "w-32",
      cell: (r) => (
        <StatusToggle
          row={r}
          label={r.account_name}
          // Blocking is the destructive direction and `setMasterActive` gates it
          // as `delete` server-side.
          disabled={!perms.canDelete || isPending || statusPending}
          onChange={(active) => setStatus(r, active, { label: r.account_name ?? r.account_no })}
        />
      ),
    },
    rowActionsColumn(
      (r) => (
        /* One ⋮ per row instead of three inline icons: View, Edit, a rule, then
           Delete behind a confirm dialog. The View is automatic —
           `rowActionsColumn` publishes the row and the menu reads it, exactly as
           `RowActions` did here before, so the eye this screen already had is
           not lost. */
        <TableRowActionsMenu
          label={r.account_name}
          onEdit={() => openEdit(r)}
          onDelete={() => remove(r)}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
          isPending={isPending}
        />
      ),
      ROW_ACTIONS_MENU_WIDTH,
    ),
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search bank…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="ob-filter-status">Status</Label>
            <Select
              id="ob-filter-status"
              value={filterValues.status}
              onChange={(e) => {
                setFilter("status", e.target.value);
                pg.setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="our_banks" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Bank
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        {/* `rowClassName` dims a switched-off row's DATA cells and leaves the
            last one alone — the ⋮ must stay legible on a dimmed row, and
            `opacity` on the `<tr>` would take it down with the text. Same rule
            `MasterListShell` applies to the listings it owns. */}
        <DataTable
          columns={withCreatedColumns(columns, pg.paged)}
          rows={pg.paged}
          getKey={(r) => r.id}
          rowClassName={(r) => (isInactive(r) ? "[&>td:not(:last-child)]:opacity-60" : undefined)}
          empty="No bank records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No bank records yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.account_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.bank_name ?? "—"} — {r.branch_name ?? "—"}
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

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Bank" : "New Bank"}
        footer={
          /* `mr-auto` inside the Sheet footer's `justify-end` row: the auto
             margin eats the free space on the RIGHT, so this box starts at the
             left edge and the buttons — right-aligned inside it — end exactly
             where the card above them ends. Without it they stay pinned to the
             1180px pane and Save floats most of a screen away from the last
             field it saves. `FORM_W` is the same string the card takes; that is
             rule 3's second reader. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.account_name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* Eight fields, ONE ROW — one titled section (LAYOUT.md §4). `cols={1}`
            because they are NOT on the twelfths track any more: the `FieldRow`
            below is a content-width flex row that packs them by WIDTH, and with
            `nowrap` it is the only row the section has to stack. Legacy field
            order preserved. Widths and the arithmetic are in `OUR_BANK_W` and
            `FORM_W` above. */}
        <DetailSection label="Details" cols={1} className={FORM_W}>
          {/* `nowrap` (client 2026-09-10) — the eight fields read as one band,
              and here the fold is the defect rather than the graceful
              degradation `FieldRow` normally offers. `FIELD_ROW_NOWRAP`'s own
              note records the same request from Customer ▸ Identity: at 1072px
              the row fits the Sheet's pane with 92px spare, and a window narrow
              enough to fold it drops ONE field — the Inactive switch, or Address
              — onto a second line where it reads as a stray. `[&>*]:shrink-0`
              comes with it and is the half that matters more: without it flex
              compresses all eight below the widths in `OUR_BANK_W` and the
              values clip with no visible cause.

              NO PICKER ON THIS ROW, which is what makes `nowrap` safe here.
              `nowrap` puts `overflow-x-auto` on the outer container, so an
              in-flow popup would be clipped by it — every control here is an
              `Input`, a `ValidatedInput` or the `Toggle`, none of which opens
              one. `ValidatedInput`'s format message is in flow but renders
              BELOW, and the container has no fixed height, so it grows the row
              rather than being cut off.

              `gap="pack"` (8px) rather than the 10px `nowrap` brings by itself,
              which is the gap the client asked for and the tightest of the
              three the row vocabulary allows. It buys 14px across the row —
              nothing that decides a width — so what it is actually for is the
              reading: eight controls at 8px apart group as one object.

              `align="start"`, and this row has the hazard that choice is for:
              three of its eight cells render something BELOW the control —
              Account No carries a `DuplicateError`, and it, Swift and IFSC are
              each a `ValidatedInput` that shows a format message there.
              `items-end` measures from the bottom of that, so the moment one of
              them complained its LABEL would jump a line above every other label
              on the row. Nothing here has the opposite hazard, which is the case
              top alignment cannot serve — and after the two `hug` widths that is
              true by ONE PIXEL OF SLACK rather than by luck: the longest label,
              "Account Name", is 85.9px of Inter 600 at 12px inside its 88px box.
              That is what `hug` means and where its number comes from. Nothing on
              this row may go narrower than its own label without moving the row to
              `items-end`, which trades this hazard for the other one. */}
          <FieldRow nowrap gap="pack" align="start">
          {/* The one field this record cannot exist without: an Our Bank row is
              here to be PRINTED on a proforma invoice so a buyer can wire money
              to it, and without the account number it serves no purpose at all.

              Deliberately the only one. The schema makes account_no, swift_code
              and ifsc_code `nullableKind` — format-checked when present, never
              demanded — because a domestic account has no SWIFT and a foreign one
              may have no IFSC. Requiring either would make half the real accounts
              unsaveable, which is the over-marking AGENTS.md warns about: the test
              is "must the record be unsaveable without it?", not "should this
              usually be filled?". */}
          <Field label="Account No" required w={OUR_BANK_W.account_no} htmlFor="ob-account-no">
            <ValidatedInput
              id="ob-account-no"
              format="account"
              value={form.account_no}
              onChange={(e) => setForm({ ...form, account_no: e.target.value })}
              {...dupFieldProps(dupError, "ob-account-no")}
            />
            <DuplicateError error={dupError} id="ob-account-no" />
          </Field>
          <Field label="Account Name" w={OUR_BANK_W.account_name} htmlFor="ob-account-name">
            <Input
              id="ob-account-name"
              uppercase
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            />
          </Field>
          <Field label="Bank Name" w={OUR_BANK_W.bank_name} htmlFor="ob-bank-name">
            <Input
              id="ob-bank-name"
              uppercase
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            />
          </Field>
          <Field label="Branch Name" w={OUR_BANK_W.branch_name} htmlFor="ob-branch-name">
            <Input
              id="ob-branch-name"
              uppercase
              value={form.branch_name}
              onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
            />
          </Field>
          <Field label="Swift Code" w={OUR_BANK_W.swift_code} htmlFor="ob-swift">
            <ValidatedInput
              id="ob-swift"
              format="swift"
              value={form.swift_code}
              onChange={(e) => setForm({ ...form, swift_code: e.target.value })}
            />
          </Field>
          <Field label="IFSC Code" w={OUR_BANK_W.ifsc_code} htmlFor="ob-ifsc">
            <ValidatedInput
              id="ob-ifsc"
              format="ifsc"
              value={form.ifsc_code}
              onChange={(e) => setForm({ ...form, ifsc_code: e.target.value })}
            />
          </Field>
          <Field label="Address" w={OUR_BANK_W.address} htmlFor="ob-address">
            <Input
              uppercase
              id="ob-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          {/* NO INACTIVE SWITCH HERE ANY MORE (client 2026-08-17: "block option
              move to that table listing — we are used to give that block while
              CREATING the data but we need to move this in ACTION only, no more
              in the creating screen"). It is the listing's Status column now: a
              switch on the row, wired straight to `setStatus` above, with
              `our_bank` registered in `lib/masters/active-registry.ts`.

              **The row control had to land first** — it is the only route to the
              flag once the field is gone, so deleting the field on its own would
              have made blocking a bank impossible rather than moved it. Same
              order Country, Destination and Bank followed.

              `form.inactive` is STILL in the form state and still round-trips
              through `submit()`, so editing a blocked bank does not quietly
              switch it back on. The value is simply no longer typed here.

              IT ALSO RETIRES THE ONE ESTIMATE IN `FORM_W` ABOVE. That sum
              counted the switch's width from its own word, which is the only
              term in the row arithmetic nobody could check by reading. Seven
              cells now, all of them a declared step, and New and Edit finally
              show the SAME row rather than one with a cell missing from the
              end. */}
          </FieldRow>
        </DetailSection>
      </Sheet>
    </div>
  );
}
