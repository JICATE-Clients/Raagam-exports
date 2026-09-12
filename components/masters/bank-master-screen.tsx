"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { RecordViewSheet, ViewPairs, type ViewPair } from "@/components/masters/record-view-sheet";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { effectiveWhatsApp, isWhatsAppSameAsMobile } from "@/lib/validation/contact";
import { useFormDraft } from "@/lib/use-form-draft";
import { createBank, updateBank, deleteBank } from "@/lib/masters/bank-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { BANK_TYPES, type Bank, type BankBranch, type BankInput, type BankType } from "@/lib/masters/bank-types";
import type { Country } from "@/lib/masters/country-types";
import { isInactive } from "@/lib/masters/inactive";
import { useBlockAction } from "@/components/masters/use-block-action";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { BANK_NAMES } from "@/lib/masters/name-vocabularies";
import { createdSection } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
// isd_code comes along for the ride so a branch's WhatsApp chip can build a
// wa.me link with the right country prefix instead of assuming +91.
type CountryOption = Pick<Country, "id" | "code" | "name" | "isd_code" | "inactive">;
type BranchRow = {
  key: string;
  country_id: string;
  state: string;
  city: string;
  pin: string;
  street: string;
  land_line: string;
  mobile: string;
  /** null = "same as mobile" (the tick is on). "" = tick off, nothing typed yet. */
  whatsapp: string | null;
  email: string;
  swift_rtgs_code: string;
  current_acc_no: string;
  ifs_code: string;
};

const BLANK = { code: "", bank_type: "Foreign" as BankType, name: "", inactive: false };

/**
 * DETAILS, SHRINK-WRAPPED (`erp-form-compact`; client 2026-09-10, bank fields
 * "compact tighten properly") — three controls that were `sm + lg + sm`, i.e.
 * 3 + 6 + 3 of twelve, on a `Sheet` that is `max-w-[1180px]`.
 *
 * So a bank CODE stood in a ~285px box, and the Foreign/Local radio pair — two
 * words and two 16px dots, ~151px of actual control — stood in another one with
 * 134px of nothing after it. That is rule 1 exactly: the cell is a share of the
 * pane and holds its width whatever is put in it. The old note above this
 * section is the tell, and it is honest about what it was doing — "3 + 6 + 3 =
 * 12, one flush row. It was sm + lg + md = 13, which overflowed the track" — the
 * numbers being balanced there are the TRACK'S, not a measurement of anything a
 * bank holds.
 *
 *   code 144  Code, and Name.
 *
 * NAME IS `code` (144), AND THAT IS THE SIBLING MASTERS' ANSWER RATHER THAN A
 * NEW ONE. A party's own name has no schema maximum, so `FieldWidth`'s stated
 * test argues for `name` (288) — and Consignee, Notify and Vendor each narrowed
 * exactly this box to 144 on the client's instruction of 2026-09-09, Consignee's
 * map recording the reasoning in writing. A bank is the same kind of party on
 * the same kind of master, so a third opinion here is the drift
 * `lib/ui/sizes.ts` exists to stop. A long name still scrolls inside the box, as
 * it does at every step.
 *
 * NOT `party` (200), though this screen is where the word "bank" appears in that
 * step's own definition. `party` is for a name in a picker TRIGGER, and
 * `lib/ui/sizes.ts` refuses it for a typing surface in the same paragraph:
 * reaching for it to widen a text input is "size to the data". Here the operator
 * types the bank rather than picking it.
 *
 * THE TYPE RADIO TAKES NO `w` AT ALL. A radio pair is not one of the widths — it
 * is a control exactly as wide as its own two words — and an unsized `Field` in
 * a flex row is exactly as wide as what is in it. Employee's Inactive switch
 * records the same call for the same reason one master over.
 */
const DETAILS_W = {
  code: "code", //  a short bank code
  name: "code", //  the party's own name, as Consignee / Notify / Vendor
} satisfies Record<string, FieldWidth>;

/**
 * AND THE DETAILS CARD IS CAPPED TO THAT ROW (`erp-form-compact` rule 4).
 * Narrowing the fields does not narrow the card: `DetailSection` is a block box
 * and goes on filling the sheet, so without this the three tightened controls
 * sit in the left 40% of an 1140px box and the surplus reads as a hole — the
 * same complaint one card out.
 *
 *   144 + 144 + ~151  =  439 + 2 x 12 = 463   Code, Name, the radio pair
 *   + 2 x 10                                  `DetailSection`'s `p-2.5`
 *   + 2 x 1                                   its border
 *   = 485  ->  31rem (496), 11px of slack
 *
 * THE RADIO IS THE ONE ESTIMATE ON THIS SCREEN, so it is rounded up rather than
 * down: a 16px dot, `gap-1.5`, "Foreign" at Inter 14px (~53px), the row's own
 * `gap-4`, then the same again for "Local" (~38px). Every other number here is a
 * step of the vocabulary. Nothing folds if the cap is a little generous and a
 * cap 10px short would drop the radio onto a line of its own, so if those two
 * words are ever translated this is the constant to re-check.
 *
 * A definite length, never `max-w-fit`: `DetailSection`'s root declares
 * `@container/section`, so a content-sized cap on it resolves to zero and the
 * card collapses. `employee-master-screen.tsx`'s `IDENTITY_BOX_W` carries the
 * long version of that note.
 */
const DETAILS_BOX_W = "max-w-[31rem]";

/**
 * A BRANCH'S TWELVE FIELDS, SHRINK-WRAPPED — the same conversion, on the card
 * where twelve of this screen's fifteen controls actually live.
 *
 * Every one of them was `size="sm"`, and the note above `renderMobileRow` stated
 * that as though it were the design: "Every field is `sm` (3 of 12), so the
 * twelve fall into three flush rows of FOUR". Four equal cells is a statement
 * about the TRACK — it gave a six-digit PIN the same ~272px as a street, and it
 * is why Street's own comment had to argue at length for staying `sm` when the
 * value wanted more ("the only way to widen Street is to break it"). That
 * argument dissolves here: a width is not taken from a neighbour, so Street can
 * be 288 without anything else giving anything up.
 *
 * NO HAND-TYPED PIXELS. Every step is one an address block on a sibling master
 * already settled — Consignee's `ADDRESS_W` is the closest, field for field:
 *
 *   code  144  Country, State, City, Land Line, and the two bank codes. The
 *              place trio is what Consignee, Customer and Vendor give City and
 *              State; a land line prints as 0422-2345678, ~100px of Inter at
 *              14px plus the input's own padding, so `range` would clip it.
 *   range 112  Pin. Six digits, a hard maximum, and the 90-120 band this step
 *              exists for — four masters state this same value for this field.
 *   name  288  Street and E-Mail. A postal line has no hard maximum, which is
 *              the test `FieldWidth` states, and an address genuinely is longer
 *              than a name.
 *   term  176  Mobile, WhatsApp and Current Acc No — and the last of those takes
 *              it for a different reason from the first two, which is worth
 *              saying out loud. Mobile and WhatsApp are `MobileField` /
 *              `WhatsAppField`, each an input with a `ContactChip` beside it in
 *              the same cell, so at `code` the number would be squeezed by a
 *              fixed 28px button: that is Consignee's stated reason for the
 *              identical step. The account number takes it for the VALUE
 *              instead — up to 18 digits, the measurement `OUR_BANK_W` and
 *              Employee's `BANK_W` both already settled on.
 *
 * DERIVED, AND IT KEEPS THE THREE READING ROWS THE OLD TRACK HAPPENED TO GIVE.
 * One `FieldRow` wrapping, with `FORM_W` below fixing where it breaks:
 *
 *   144 + 144 + 144 + 112  =  544 + 3 x 12 = 580   where the branch is
 *   288 + 144 + 176 + 176  =  784 + 3 x 12 = 820   the address, then the phones
 *   288 + 144 + 144 + 176  =  752 + 3 x 12 = 788   e-mail, then the codes
 *
 * The JSX order is untouched, so the KEYBOARD path is untouched — Tab still runs
 * where / address+phones / email+codes, which the old note correctly called the
 * point of writing them in that order. What changes is that the fold is now
 * derived from what the fields measure instead of from four cells adding to
 * twelve.
 */
const BRANCH_W = {
  country: "code",
  state: "code",
  city: "code",
  pin: "range", //           6 digits
  street: "name", //         a postal line — no schema maximum
  land_line: "code", //      0422-2345678, wider than `range` holds
  contact: "term", //        Mobile and WhatsApp: input + ContactChip
  email: "name", //          an address is longer than a name
  swift_rtgs_code: "code",
  ifs_code: "code",
  current_acc_no: "term", // up to 18 digits, as Our Bank's Account No
} satisfies Record<string, FieldWidth>;

/**
 * THE FORM'S WIDTH — `erp-form-compact` rule 4's "cap a sub-grid to the FORM's
 * width, not the screen's", and here the sub-grid IS the widest thing in the
 * form, so this one constant is the form's own edge.
 *
 * Two readers: the wrapper around the branch grid, and the footer's button box,
 * so Cancel and Save end where the card above them ends rather than a
 * sheet-width to its right.
 *
 *   820       the widest of the three branch lines
 *   + 2 x 10  `ChildGrid`'s `GRID_FRAME` padding (`p-2.5`; its
 *             `@2xl/editor:p-2` is narrower still, which only ever leaves the
 *             fields more room)
 *   + 2 x 1   its border
 *   = 842  ->  54rem (864), 22px of slack
 *
 * IT IS WHAT DECIDES THE FOLD. Street joining line 1 would need 580 + 12 + 288 =
 * 880, so the three lines hold at any cap from 842 up to ~901 — that is the
 * number to check before widening this constant. Uncapped, the card fills the
 * sheet's ~1140px and Street climbs onto line 1, which is the shape the old
 * four-per-row track existed to prevent.
 *
 * A WRAPPER `<div>`, NOT A PROP. `ChildGrid` takes no root `className`, and its
 * own `hugsContent` / `cardHug` path is the wrong tool twice over: it needs
 * every COLUMN to declare a width, and these `columns` are the never-rendered
 * fallback pair — and `cardHug`'s own note records that a `w-fit` around a
 * `forceCards` grid COLLAPSES it, because `renderMobileRow`'s root is a
 * container query and so contributes zero to `fit-content`. A cap on a plain
 * parent has neither problem.
 */
const FORM_W = "max-w-[54rem]";
const blankBranch = (key: string): BranchRow => ({
  key,
  country_id: "",
  state: "",
  city: "",
  pin: "",
  street: "",
  land_line: "",
  mobile: "",
  whatsapp: null,
  email: "",
  swift_rtgs_code: "",
  current_acc_no: "",
  ifs_code: "",
});

/**
 * The one column whose LABEL depends on the header: `swift_rtgs_code` dual-holds
 * a SWIFT code (Foreign) and an RTGS/NIFT one (Local). Module-level so the
 * editor's branch card and the read-only view cannot label the same digits
 * differently — "Swift Code" on a local bank would simply be wrong.
 */
function codeLabelFor(t: BankType | null): string {
  return t === "Local" ? "RTGS/NIFT Code" : "Swift Code";
}

/**
 * WHERE — CODE for one branch, so a collapsed card (or a line in the view sheet)
 * says which branch it is without being read in full. Place falls back down
 * country → state → city because a branch is keyed by its town in conversation
 * ("the Chennai one"); the code falls back to SWIFT because a Foreign bank has
 * no IFSC. Returns "" when the row is blank — the caller decides what to say.
 *
 * Takes the nullable shape so the stored `BankBranch` and the editor's
 * all-strings `BranchRow` can both be passed.
 */
function branchSummary(
  b: {
    country_id: string | null;
    state: string | null;
    city: string | null;
    ifs_code: string | null;
    swift_rtgs_code: string | null;
  },
  countryLabel: Map<string, string>,
): string {
  const place =
    (b.city ?? "").trim() ||
    (b.state ?? "").trim() ||
    (b.country_id ? countryLabel.get(b.country_id) ?? "" : "");
  const code = (b.ifs_code ?? "").trim() || (b.swift_rtgs_code ?? "").trim();
  return [place, code].filter(Boolean).join(" — ");
}

/**
 * Master-detail CRUD for the legacy "Bank" master: header (Code · Foreign/Local ·
 * Name · Inactive) + a "Bank Detail" branch grid. The single code column reads
 * "Swift Code" for Foreign banks and "RTGS/NIFT Code" for Local ones.
 */
export function BankMasterScreen({
  rows,
  countries,
  perms,
}: {
  rows: Bank[];
  countries: CountryOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  /* The Status SWITCH in the listing (client 2026-09-11). `setStatus` does the
     write, the toast and the refresh; `bank` is registered in
     `lib/masters/active-registry.ts`.

     IT REPLACES `blockItem`, which used to sit in the ⋮ beside Duplicate. One
     master, one control for the flag: leaving both would give a bank two places
     to be blocked from, and the menu item would be the one that never says which
     way the row is currently set. */
  const { setStatus, isPending: statusPending } = useBlockAction("bank");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  // The record being LOOKED at, as opposed to edited. Null = closed.
  const [viewRow, setViewRow] = useState<Bank | null>(null);
  const keySeq = useRef(0);
  const newKey = () => `b${keySeq.current++}`;

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const dupError = useDuplicateName({
    table: "banks",
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
    seed: BANK_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });
  const codeLabel = codeLabelFor(form.bank_type);

  // Autosave the in-progress form to localStorage; offer to restore it if the
  // editor is re-opened after an accidental close/refresh (checklist Auto Save).
  const draft = useFormDraft({
    storageKey: `masters:bank:${editId ?? "new"}`,
    enabled: open,
    value: { form, branches },
    onRestore: (v) => {
      setForm(v.form);
      setBranches(v.branches);
    },
  });

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  const isdOf = useIsdLookup(countries);

  /**
   * One stored branch as label→value rows for the view sheet. The country is
   * folded into the address line rather than given a row of its own — a reader
   * scanning branches wants one place, not five fragments — and every FK is
   * resolved through `countryLabel`, the same map the editor's Combobox uses.
   */
  function branchPairs(bank: Bank, b: BankBranch): ViewPair[] {
    const address = [b.street, b.city, b.state, b.pin, b.country_id ? countryLabel.get(b.country_id) : null]
      .map((v) => (v ?? "").trim())
      .filter(Boolean)
      .join(", ");
    return [
      ["Address", address],
      ["Land Line", b.land_line],
      ["Mobile", b.mobile],
      // NULL = "same as mobile" (lib/validation/contact), and the Mobile row
      // directly above already shows that number — so only an explicitly
      // DIFFERENT WhatsApp number earns a row.
      ["WhatsApp", isWhatsAppSameAsMobile(b) ? null : effectiveWhatsApp(b)],
      ["E-Mail", b.email],
      [codeLabelFor(bank.bank_type), b.swift_rtgs_code],
      ["IFS Code", b.ifs_code],
      ["Current Acc No", b.current_acc_no],
    ];
  }

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setBranches([blankBranch(newKey())]);
    setOpen(true);
  }
  function openEdit(r: Bank) {
    setEditId(r.id);
    setForm({ code: r.code ?? "", bank_type: r.bank_type ?? "Foreign", name: r.name, inactive: r.inactive });
    setBranches(
      r.branches.map((b) => ({
        key: newKey(),
        country_id: b.country_id ?? "",
        state: b.state ?? "",
        city: b.city ?? "",
        pin: b.pin ?? "",
        street: b.street ?? "",
        land_line: b.land_line ?? "",
        mobile: b.mobile ?? "",
        // Deliberately NOT `?? ""` — a stored NULL is the "same as mobile"
        // state and must survive the round-trip.
        whatsapp: b.whatsapp,
        email: b.email ?? "",
        swift_rtgs_code: b.swift_rtgs_code ?? "",
        current_acc_no: b.current_acc_no ?? "",
        ifs_code: b.ifs_code ?? "",
      })),
    );
    setOpen(true);
  }

  function openDuplicate(r: Bank) {
    // Duplicate = a new record pre-filled from this one (checklist Quick
    // Actions). Code is cleared (it must be unique / auto), name gets a "(Copy)"
    // suffix, and branches carry over.
    setEditId(null);
    setForm({
      code: "",
      bank_type: r.bank_type ?? "Foreign",
      name: r.name ? `${r.name} (COPY)` : "",
      inactive: false,
    });
    setBranches(
      r.branches.map((b) => ({
        key: newKey(),
        country_id: b.country_id ?? "",
        state: b.state ?? "",
        city: b.city ?? "",
        pin: b.pin ?? "",
        street: b.street ?? "",
        land_line: b.land_line ?? "",
        mobile: b.mobile ?? "",
        // Deliberately NOT `?? ""` — a stored NULL is the "same as mobile"
        // state and must survive the round-trip.
        whatsapp: b.whatsapp,
        email: b.email ?? "",
        swift_rtgs_code: b.swift_rtgs_code ?? "",
        current_acc_no: b.current_acc_no ?? "",
        ifs_code: b.ifs_code ?? "",
      })),
    );
    setOpen(true);
  }

  function addBranch() {
    setBranches((bs) => [...bs, blankBranch(newKey())]);
  }
  function setBranchAt(key: string, patch: Partial<BranchRow>) {
    setBranches((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }
  function removeBranch(key: string) {
    setBranches((bs) => bs.filter((b) => b.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: BankInput = {
        code: form.code.trim() || null,
        bank_type: form.bank_type,
        name: form.name.trim(),
        inactive: form.inactive,
        branches: branches.map((b, i) => ({
          sno: i + 1,
          country_id: b.country_id || null,
          state: b.state,
          city: b.city,
          pin: b.pin,
          street: b.street,
          land_line: b.land_line,
          mobile: b.mobile,
          whatsapp: b.whatsapp,
          email: b.email,
          swift_rtgs_code: b.swift_rtgs_code,
          current_acc_no: b.current_acc_no,
          ifs_code: b.ifs_code,
        })),
      };
      const res = editId ? await updateBank(editId, payload) : await createBank(payload);
      if (res.ok) {
        success(editId ? "Bank updated." : "Bank added.");
        draft.clear();
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Bank) {
    startTransition(async () => {
      const res = await deleteBank(r.id);
      if (res.ok) {
        success(deletedToast("Bank", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Bank>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.bank_type ?? "—"}</span> },
    {
      header: "Branches",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.branches.length}</span>,
    },
    /* NO Status COLUMN DECLARED HERE, AND THE COLUMN IS STILL THERE.
       `MasterListShell` splices it in because this screen passes
       `onStatusChange` — a switch plus the word it is set to, clicking which
       calls the status API directly. Declaring one here would be stripped as a
       duplicate; see that prop. */
  ];

  /**
   * Hold off the silent PWA auto-reload while there is work to lose
   * (AGENTS.md, STANDING).
   *
   * Bank deliberately has NO `pristine` snapshot of its own: `useFormDraft`
   * already holds exactly that — a JSON snapshot of `{ form, branches }` taken
   * when the editor opened, recompared on every render — and exposes it as
   * `isDirty`. A second copy here would be duplicate state that can only drift
   * from the one driving the autosave.
   *
   * The call is still needed on top of that hook. `useFormDraft` registers
   * `isDirty` alone, and `Sheet` registers only the OPEN OVERLAY — neither
   * covers `isPending`, and a reload landing mid-server-action loses the
   * success toast and leaves the user unsure whether the save committed. The
   * guard is a counter, so the overlapping registration is harmless.
   */
  const dirty = draft.isDirty;
  useUnsavedGuard(dirty || isPending);

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.bank_type].filter(Boolean).join(" ")}
        searchPlaceholder="Search bank…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Bank"
        onAdd={openAdd}
        columns={columns}
        actions={{
          onView: setViewRow,
          onEdit: openEdit,
          onDelete: remove,
          /* One ⋮ per row instead of three inline icons: View, Edit, a rule,
             then Delete behind a confirm dialog. */
          variant: "menu",
          /* Gives the list its Status column of switches, and is what the switch
             calls. `active` is stated positively; nothing here flips the boolean. */
          onStatusChange: (r, active) => setStatus(r, active, { label: r.name }),
          // Duplicate lives behind the ⋮ — it is a create, not row CRUD, and it
          // is the only master that offers one. Block / Unblock USED to sit here
          // too; the Status switch replaced it — see `setStatus` above.
          menu: (r) =>
            perms.canCreate && perms.canEdit
              ? [{ label: "Duplicate", icon: Copy, onClick: () => openDuplicate(r) }]
              : [],
        }}
        empty="No bank records yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            `${r.bank_type ?? "—"} · ${r.branches.length} branch${r.branches.length === 1 ? "" : "es"}`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending || statusPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Bank" : "New Bank"}
        footer={
          /* `mr-auto` inside the Sheet footer's `justify-end` row: the auto margin
             eats the free space on the RIGHT, so this box sits at the left edge and
             the buttons — right-aligned inside it by `justify-end` — end exactly
             where the branch card above them ends. Without it they stay pinned to
             the 1180px sheet and float a third of a screen away from an 864px form.
             `FORM_W` is the arithmetic, stated once at the top of this file. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !!dupError || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* Single column, header ABOVE the branches — BOTH visible at once, on
            purpose.

            This screen was converted to the `MasterFullScreen` section rail and
            converted straight back (client 2026-07-29). Two reasons, and the
            second is the one that decided it:

            - There is nothing here to navigate to. Details is ONE row; a rail
              whose whole job is navigation had two destinations, one of them
              ~90px tall.
            - `codeLabel` below is derived from `form.bank_type`, so the
              Foreign/Local radio in Details RENAMES a column in the branch grid
              ("Swift Code" ↔ "RTGS/NIFT Code"). A rail puts those two on
              different screens: you flip the radio and cannot see what it did.
              That coupling is particular to bank — it is why bank came off the
              list of five and the other four stayed on it.

            It was also a SectionGrid once, with Details LEFT and Bank Detail
            RIGHT — but Details holds three fields, so the left half sat empty
            for the whole height of the branch panel while the panel itself was
            squeezed to ~570px. That is below `@lg/section` once the card's own
            padding is taken off, so the twelve branch spans silently stopped
            applying and every field stacked one per row. Stacking the two
            sections gives the branch cards the full 1180px, which is what lets
            four fields share a row. Same call, same reason, as
            material-attribute-master-screen. */}
        <div className="space-y-3">
          {draft.hasDraft && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-info bg-info-soft px-3 py-2 text-sm text-info">
              <span>Unsaved changes from an earlier session were found.</span>
              <span className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={draft.restore}>
                  Restore
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={draft.discard}>
                  Discard
                </Button>
              </span>
            </div>
          )}
          {/* ONE `FieldRow`, laid out by WIDTHS — `DETAILS_W` at the top of this
              file carries the arithmetic and `DETAILS_BOX_W` caps the card to it.
              `cols={1}`, because that row is the only child this section places;
              the twelfths it used to balance ("3 + 6 + 3 = 12, one flush row")
              are gone from this screen.

              `align="start"`, NOT `FieldRow`'s default `items-end`: Name renders
              a `DuplicateError` and a `SpellSuggestHint` BELOW its input, and
              both appear mid-typing. That is `erp-form-compact` rule 4's choice —
              `items-end` is for a LABEL that outgrows its narrow box, `start` for
              a field that grows DOWNWARDS — and on an `items-end` row the first
              collision would drop Name's own label ~16px below Code's. */}
          <DetailSection label="Details" cols={1} className={DETAILS_BOX_W}>
            <FieldRow align="start">
            <Field label="Code" w={DETAILS_W.code} htmlFor="bk-code">
              <Input
                uppercase
                id="bk-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
              />
            </Field>
            <Field label="Name" w={DETAILS_W.name} required htmlFor="bk-name">
              <Input
                id="bk-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                {...dupFieldProps(dupError, "bk-name")}
              />
              <DuplicateError error={dupError} id="bk-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => setForm((f) => ({ ...f, name: v }))}
              />
            </Field>
            {/* A radio set is one field with several controls; the inline gap
                is intra-control spacing, not page layout. `h-8` matches the
                compact control height so it sits on the same baseline.

                NO `w`: a radio pair is not one of the widths — it is exactly as
                wide as its own two words — and an unsized `Field` in a flex row
                is exactly as wide as what is in it. `DETAILS_BOX_W` above counts
                it at ~151px, the one estimate in that arithmetic. */}
            <Field label="Type">
              <div className="flex h-8 items-center gap-4">
                {BANK_TYPES.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="bank_type"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={form.bank_type === t}
                      onChange={() => set({ bank_type: t })}
                    />
                    <span className="text-sm text-foreground">{t}</span>
                  </label>
                ))}
              </div>
            </Field>
            {/* THE INACTIVE CHECKBOX IS GONE FROM THIS FORM (client 2026-08-17):
                blocking is a row ACTION on the listing now, never a field while
                the record is being created or edited. `form.inactive` is still
                in the input and still round-trips, so an edit cannot null it —
                the value is simply no longer typed here. See
                `useBlockAction` / `lib/masters/active-registry.ts`. */}
            </FieldRow>
          </DetailSection>

          {/* Twelve fields per branch — well past the ~5 a row can hold, so
              stacked cards with a `FieldRow` inside (LAYOUT.md §6). The fields
              were labelled by PLACEHOLDER, which disappears the moment anyone
              types; they carry real labels now. Replaces a hand-rolled list
              with its own header band, `#` column, remove button and a
              `max-h-96` scroller. */}
          {/* CAPPED TO THE FORM, NOT THE SHEET (`erp-form-compact` rule 4), and
              on a plain wrapper because `ChildGrid` takes no root `className` and
              its own hug path collapses a `forceCards` card. `FORM_W` at the top
              of this file carries both halves of that. */}
          <div className={FORM_W}>
          <ChildGrid<BranchRow>
            lockExisting
            label="Bank Detail"
            rows={branches}
            onAdd={addBranch}
            onRemove={(b) => removeBranch(b.key)}
            addLabel="+ Add branch"
            forceCards
            flatRows
            pageSize={3}
            // `forceCards` + `renderMobileRow` mean these never render; they
            // are the fallback if this grid is ever switched back to a table.
            columns={[
              { header: "City", cell: (b) => b.city },
              { header: "IFS Code", cell: (b) => b.ifs_code },
            ]}
            // WHERE — CODE (see `branchSummary`, shared with the view sheet so
            // a branch reads the same collapsed as it does read-only). A
            // brand-new row has neither and says so rather than rendering an
            // empty band.
            rowSummary={(b) => {
              const summary = branchSummary(b, countryLabel);
              if (!summary) {
                return <span className="font-normal text-muted-foreground">New branch</span>;
              }
              return summary;
            }}
            // ONE `FieldRow`, laid out by WIDTHS — `BRANCH_W` at the top of this
            // file carries the arithmetic and `FORM_W` fixes the fold. It still
            // falls into three lines of four, and they are still where / address
            // + phones / email + codes, but the break is now derived from what
            // the fields measure rather than from four cells adding up to twelve.
            // Tab follows this JSX order; reordering it reorders the keyboard
            // path, which is as much the point as it ever was.
            //
            // `align="start"`, NOT the default `items-end`, and four things on
            // this row need it: Pin, E-Mail, IFS Code and Current Acc No are
            // `ValidatedInput`s, which draw their error on a `<p>` below the
            // control, and WhatsApp carries its "Same as mobile" tick there too.
            // On an `items-end` row each of those would lift its own label above
            // its neighbours' the moment it appeared.
            renderMobileRow={(b) => (
              <FieldRow align="start">
                {/* Line 1 — where the branch is. 144+144+144+112 = 580 */}
                <Field label="Country" w={BRANCH_W.country}>
                  <Combobox
                    // `Combobox` has no inactive state of its own, so the rule
                    // is applied to the options: a switched-off country is not
                    // offered, but the one this branch already sits in stays, or
                    // the field would read empty on an existing bank.
                    options={countries
                      .filter((c) => !isInactive(c) || c.id === b.country_id)
                      .map((c) => ({
                        value: c.id,
                        label: countryLabel.get(c.id) ?? c.name,
                      }))}
                    value={b.country_id}
                    onChange={(v) => setBranchAt(b.key, { country_id: v })}
                    clearable
                  />
                </Field>
                <Field label="State" w={BRANCH_W.state}>
                  <Input
                    uppercase
                    value={b.state}
                    onChange={(e) => setBranchAt(b.key, { state: e.target.value })}
                  />
                </Field>
                <Field label="City" w={BRANCH_W.city}>
                  <Input
                    uppercase
                    value={b.city}
                    onChange={(e) => setBranchAt(b.key, { city: e.target.value })}
                  />
                </Field>
                <Field label="Pin" w={BRANCH_W.pin}>
                  <ValidatedInput
                    format="pincode"
                    value={b.pin}
                    onChange={(e) => setBranchAt(b.key, { pin: e.target.value })}
                  />
                </Field>

                {/* Line 2 — the rest of the address, then the two phones.
                    288+144+176+176 = 820, the widest of the three and therefore
                    what `FORM_W` is derived from.

                    STREET IS `name` (288) NOW, AND THE ARGUMENT THAT KEPT IT
                    NARROW IS GONE RATHER THAN OVERRULED. This comment used to
                    read "Street is `sm` ON PURPOSE … the only way to widen Street
                    is to break it — `lg` here makes the rows go 4/3/3/2 and
                    leaves the last one half empty", weighed and declined with the
                    client on 2026-07-29. That was true of a TRACK, where a width
                    is taken from a neighbour. Off it, a postal line takes the
                    step its content type takes and the other three keep theirs.
                    The 2026-07-29 decision is not being reversed; the trade it
                    was choosing between no longer exists. */}
                <Field label="Street" w={BRANCH_W.street}>
                  <Input
                    uppercase
                    value={b.street}
                    onChange={(e) => setBranchAt(b.key, { street: e.target.value })}
                  />
                </Field>
                <Field label="Land Line" w={BRANCH_W.land_line}>
                  <Input
                    value={b.land_line}
                    onChange={(e) => setBranchAt(b.key, { land_line: e.target.value })}
                  />
                </Field>
                {/* Both render their own labels, so the Field carries none.
                    WhatsApp's "Same as mobile" tick sits BELOW its input, so
                    this cell is ~18px taller and the row grows to match — that
                    is the grid stretching, not a bug to align away. */}
                <Field w={BRANCH_W.contact}>
                  <MobileField
                    id={`bk-${b.key}-mobile`}
                    value={b.mobile}
                    onChange={(v) => setBranchAt(b.key, { mobile: v })}
                  />
                </Field>
                <Field w={BRANCH_W.contact}>
                  <WhatsAppField
                    id={`bk-${b.key}-whatsapp`}
                    value={b.whatsapp}
                    mobile={b.mobile}
                    isdCode={isdOf.get(b.country_id) ?? null}
                    onChange={(v) => setBranchAt(b.key, { whatsapp: v })}
                  />
                </Field>

                {/* Line 3 — e-mail and the three bank codes. 288+144+144+176 = 788 */}
                <Field label="E-Mail" w={BRANCH_W.email}>
                  <ValidatedInput
                    format="email"
                    value={b.email}
                    onChange={(e) => setBranchAt(b.key, { email: e.target.value })}
                  />
                </Field>
                <Field label={codeLabel} w={BRANCH_W.swift_rtgs_code}>
                  <Input
                    uppercase
                    value={b.swift_rtgs_code}
                    onChange={(e) => setBranchAt(b.key, { swift_rtgs_code: e.target.value })}
                  />
                </Field>
                <Field label="IFS Code" w={BRANCH_W.ifs_code}>
                  <ValidatedInput
                    format="ifsc"
                    value={b.ifs_code}
                    onChange={(e) => setBranchAt(b.key, { ifs_code: e.target.value })}
                  />
                </Field>
                <Field label="Current Acc No" w={BRANCH_W.current_acc_no}>
                  <ValidatedInput
                    format="account"
                    value={b.current_acc_no}
                    onChange={(e) => setBranchAt(b.key, { current_acc_no: e.target.value })}
                  />
                </Field>
              </FieldRow>
            )}
          />
          </div>
        </div>
      </Sheet>

      {/* Read-only view — the same record, nothing editable, Edit in the footer
          hands off to the editor above. Renders straight off the list row; a
          bank arrives with its branches already attached, so nothing is
          fetched here. */}
      {viewRow && (
        <RecordViewSheet
          open
          onClose={() => setViewRow(null)}
          title={viewRow.name}
          subtitle={viewRow.code}
          status={
            <StatusPill tone={viewRow.inactive ? "danger" : "success"}>
              {viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          }
          sections={[
            {
              label: "Details",
              pairs: [
                ["Type", viewRow.bank_type],
                ["Branches", viewRow.branches.length],
              ],
            },
            {
              label: "Bank Detail",
              // `content`, not `pairs`: a branch is twelve fields, and the
              // reader's first question is WHICH branch — so each one leads
              // with the same "place — code" line the editor's collapsed card
              // shows, then lists what it holds. An empty list is worth saying
              // out loud here: a bank with no branch has no account number and
              // cannot be paid.
              content:
                viewRow.branches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No branches recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {viewRow.branches.map((b) => (
                      <div key={b.id} className="space-y-1.5 rounded-md border border-border p-2">
                        <div className="text-sm font-medium text-foreground">
                          {branchSummary(b, countryLabel) || `Branch ${b.sno}`}
                        </div>
                        <ViewPairs pairs={branchPairs(viewRow, b)} />
                      </div>
                    ))}
                  </div>
                ),
            },
            ...createdSection(viewRow),
          ]}
        />
      )}
    </div>
  );
}
