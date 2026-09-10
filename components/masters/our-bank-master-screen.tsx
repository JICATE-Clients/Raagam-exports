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
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
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
import { Toggle } from "@/components/ui/toggle";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = { account_no: "", account_name: "", bank_name: "", branch_name: "", swift_code: "", ifsc_code: "", address: "", inactive: false };

/**
 * OUR BANK, SHRINK-WRAPPED (`erp-form-compact`).
 *
 * Eight fields at `size="sm"` is 3 of 12 each, and a `Sheet` is `max-w-[1180px]`
 * — so an ELEVEN-CHARACTER IFSC stood in a ~275px box, and so did the SWIFT
 * beside it, and so did every name on the form. A fraction cannot be made
 * compact: narrowing the control inside a twelfth leaves the CELL at its old
 * width and the value floating in it. So `FieldRow` + `Field w=`.
 *
 * The map it replaces was not careless — it read `3 + 3 + 3 + 3 = 12` and was
 * checked against that sum. But summing to 12 only says a row does not overflow;
 * it never says any field in it is the right size, and here four of the eight
 * were identifiers with a hard maximum sitting in the same box as a bank's name.
 *
 * NO HAND-TYPED PIXELS — every value lands on a step, and the two bounded ones
 * are bounded by the SCHEMA rather than by eye (`lib/validation/formats.ts`):
 *
 *   text / codes 130-160  ->  `code`  144   Swift, IFSC — `maxLength: 11` both,
 *                                           ~99px of glyphs plus the box's own
 *                                           padding, so `range` (112) would clip
 *                                           the eleventh character
 *   short options 90-120  ->  `term`  176   Account No — `maxLength: 18`, the
 *                                           widest bounded value here at ~151px
 *                                           of digits; it takes the step above
 *                                           the band because the band is drawn
 *                                           for enums, not for 18 digits
 *   free text             ->  `name`  288   Account Name, Bank Name, Branch
 *                                           Name, Address
 *
 * THE FOUR NAMES STAY AT 288 AND THAT IS THE POINT. `FieldWidth`'s test is
 * "does the value have a hard maximum the schema guarantees?", and a bank's name
 * does not — so they take the widest step, which is roughly the width they
 * already had. Nothing on this form was tightened by guessing at its longest
 * value; what was tightened is the four fields whose maximum is written down,
 * and the CARD, which used to fill 1180px whatever was in it.
 *
 * `party` (200) IS NOT FOR BANK NAME HERE, though it was added for a field of
 * that name. Its own note in `lib/ui/sizes.ts` draws the line: it is for a
 * picker TRIGGER, never to make a text input wider, because sizing a typing
 * surface to its data is the failure that file exists to prevent. This is a
 * typing surface.
 *
 *   176 + 288        = 464 + 1 x 12 = 476   account no, account name
 *   288 + 288        = 576 + 1 x 12 = 588   bank name, branch name
 *   144 + 144 + 288  = 576 + 2 x 12 = 600   swift, ifsc, address
 *
 * THREE LINES THAT EACH MEAN SOMETHING: the account, then the bank, then how a
 * remitter reaches it. The twelfths gave four fields, then three, then a lone
 * tick box, grouped by nothing but the arithmetic of 12.
 */
const OUR_BANK_W = {
  account_no: "term", //   18 digits, the schema's own maximum
  account_name: "name",
  bank_name: "name",
  branch_name: "name",
  swift_code: "code", //   8 or 11 characters
  ifsc_code: "code", //    exactly 11
  address: "name", //      the one free-text line on the form
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
 * BOTH BOUNDS MATTER, and together they make the three-line shape above a fact
 * rather than a hope:
 *
 *   >= 600   or Address drops off the third line and stands alone on a fourth
 *   <  744   (588 + a gap + a `code` field) or Swift climbs onto the bank line
 *            and the codes are split across two lines
 *
 * 640 sits between them with 40px over the floor and 104 under the ceiling.
 * `FIELD_ROW`'s `gap-x-3` is 12px at BOTH densities, so unlike a padding-derived
 * cap this arithmetic does not move between the compact and full editor.
 */
const FORM_W = "max-w-[40rem]";

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
        success("Bank deleted.");
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
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
        </StatusPill>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.account_name}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
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
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged} getKey={(r) => r.id} empty="No bank records yet." />
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
        {/* Seven fields — one titled section (LAYOUT.md §4). `cols={1}` because
            they are NOT on the twelfths track any more: the `FieldRow` below is a
            content-width flex row that packs them by WIDTH, and the section just
            stacks it above the edit-only toggle. Legacy field order preserved.
            Widths and the per-line arithmetic are in `OUR_BANK_W` above. */}
        <DetailSection label="Details" cols={1} className={FORM_W}>
          {/* `align="start"`, and this row has the hazard that choice is for:
              three of its seven cells render something BELOW the control —
              Account No carries a `DuplicateError`, and it, Swift and IFSC are
              each a `ValidatedInput` that shows a format message there.
              `items-end` measures from the bottom of that, so the moment one of
              them complained its LABEL would jump a line above every other label
              on the row. Nothing here has the opposite hazard: the longest
              label, "Account Name", is ~78px inside 288. */}
          <FieldRow align="start">
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
          </FieldRow>

          {/* A ROW OF ITS OWN, not the eighth cell of the one above, and that is
              structural rather than cosmetic. The old note here kept `inactive`
              LAST so that "rows 1-2 look identical in New and in Edit" — a
              property worth keeping, and on a packed row it would have depended
              on the toggle being wide enough not to fit beside Address (600 + a
              gap + the switch). That is an arithmetic nobody can check by
              reading, since the toggle's width is its own word. A second
              `FieldRow` makes it true by construction, and costs nothing:
              `DetailSection cols={1}` stacks with `space-y-2` / `@2xl:space-y-1.5`,
              the same rhythm `FIELD_ROW`'s own `gap-y` uses within a row.

              `Toggle`, NOT A TICK BOX (client 2026-09-08: the same switch Order
              Entry uses) — the identical swap Country, Destination and Notify
              made, and from the SAME component, so no two masters can drift
              apart. It is still a real `<input type="checkbox">` underneath
              (`components/ui/toggle.tsx` says why at length), so `isFieldLike()`
              still counts it and Tab, Enter-advance and the arrows all reach it.

              `label=""` RESERVES the label row rather than drawing one: a cell
              with no label at all collapses it and lifts the switch ~16px above
              the labelled fields beside it. The switch renders its own word, so
              a `label="Inactive"` here would draw the name twice. */}
          {editId && (
            <FieldRow>
              {/* No `w` at all: the switch renders its own word and hugs it, so
                  a step from the vocabulary would only pad it. */}
              <Field label="">
                <Toggle
                  id="ob-inactive"
                  label="Inactive"
                  checked={form.inactive}
                  onChange={(inactive) => setForm({ ...form, inactive })}
                />
              </Field>
            </FieldRow>
          )}
        </DetailSection>
      </Sheet>
    </div>
  );
}
