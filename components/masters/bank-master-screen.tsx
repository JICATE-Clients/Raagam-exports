"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Field, FieldGrid } from "@/components/ui/field";
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
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { RowActions } from "@/components/masters/row-actions";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { useFormDraft } from "@/lib/use-form-draft";
import { createBank, updateBank, deleteBank } from "@/lib/masters/bank-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { BANK_TYPES, type Bank, type BankInput, type BankType } from "@/lib/masters/bank-types";
import type { Country } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
// isd_code comes along for the ride so a branch's WhatsApp chip can build a
// wa.me link with the right country prefix instead of assuming +91.
type CountryOption = Pick<Country, "id" | "code" | "name" | "isd_code">;
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
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `b${keySeq.current++}`;

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));
  const codeLabel = form.bank_type === "Local" ? "RTGS/NIFT Code" : "Swift Code";

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
        <div className="flex items-center justify-end gap-1">
          {perms.canEdit && (
            <RowActions
              onEdit={() => openEdit(r)}
              onDuplicate={perms.canCreate ? () => openDuplicate(r) : undefined}
            />
          )}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
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
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Bank" : "New Bank"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
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
          {/* 3 + 6 + 3 = 12, one flush row. It was sm + lg + md = 13, which
              overflowed the track and wrapped Type onto a line of its own. */}
          <DetailSection label="Details" cols={12}>
            <Field label="Code" size="sm" htmlFor="bk-code">
              <Input
                uppercase
                id="bk-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
              />
            </Field>
            <Field label="Name" size="lg" required htmlFor="bk-name">
              <Input
                id="bk-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
              />
            </Field>
            {/* A radio set is one field with several controls; the inline gap
                is intra-control spacing, not page layout. `h-8` matches the
                compact control height so it sits on the same baseline. */}
            <Field label="Type" size="sm">
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
            {/* Edit only, so it takes a short second row rather than a share of
                the first — that keeps row 1 identical between New and Edit. */}
            {editId && (
              <Field size="sm">
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
          </DetailSection>

          {/* Twelve fields per branch — well past the ~5 a row can hold, so
              stacked cards with a FieldGrid inside (LAYOUT.md §6). The fields
              were labelled by PLACEHOLDER, which disappears the moment anyone
              types; they carry real labels now. Replaces a hand-rolled list
              with its own header band, `#` column, remove button and a
              `max-h-96` scroller. */}
          <ChildGrid<BranchRow>
            label="Bank Detail"
            rows={branches}
            onAdd={addBranch}
            onRemove={(b) => removeBranch(b.key)}
            addLabel="+ Add branch"
            forceCards
            pageSize={3}
            // `forceCards` + `renderMobileRow` mean these never render; they
            // are the fallback if this grid is ever switched back to a table.
            columns={[
              { header: "City", cell: (b) => b.city },
              { header: "IFS Code", cell: (b) => b.ifs_code },
            ]}
            // WHERE — CODE, so a paged card says which branch it is without
            // being read. Place falls back down country → state → city because
            // a branch is keyed by its town in conversation ("the Chennai
            // one"); the code falls back to SWIFT because a Foreign bank has no
            // IFSC. A brand-new row has neither and says so rather than
            // rendering an empty band.
            rowSummary={(b) => {
              const place = b.city.trim() || b.state.trim() || countryLabel.get(b.country_id) || "";
              const code = b.ifs_code.trim() || b.swift_rtgs_code.trim();
              if (!place && !code) {
                return <span className="font-normal text-muted-foreground">New branch</span>;
              }
              return [place, code].filter(Boolean).join(" — ");
            }}
            // Every field is `sm` (3 of 12), so the twelve fall into three
            // flush rows of FOUR — where / address + phones / email + codes.
            // Tab follows that reading order; reordering this JSX reorders the
            // keyboard path, which is the point.
            renderMobileRow={(b) => (
              <FieldGrid>
                {/* Row 1 — where the branch is. 3+3+3+3 = 12 */}
                <Field label="Country" size="sm">
                  <Combobox
                    options={countries.map((c) => ({
                      value: c.id,
                      label: countryLabel.get(c.id) ?? c.name,
                    }))}
                    value={b.country_id}
                    onChange={(v) => setBranchAt(b.key, { country_id: v })}
                    placeholder="— Select —"
                    clearable
                  />
                </Field>
                <Field label="State" size="sm">
                  <Input
                    uppercase
                    value={b.state}
                    onChange={(e) => setBranchAt(b.key, { state: e.target.value })}
                  />
                </Field>
                <Field label="City" size="sm">
                  <Input
                    uppercase
                    value={b.city}
                    onChange={(e) => setBranchAt(b.key, { city: e.target.value })}
                  />
                </Field>
                <Field label="Pin" size="sm">
                  <ValidatedInput
                    format="pincode"
                    value={b.pin}
                    onChange={(e) => setBranchAt(b.key, { pin: e.target.value })}
                  />
                </Field>

                {/* Row 2 — the rest of the address, then the two phones.
                    Street is `sm` ON PURPOSE, not by oversight. It was `full`
                    (~570px) when this card lived in a half-width column. Four
                    across is the standing rule for this card, and the only way
                    to widen Street is to break it — `lg` here makes the rows go
                    4/3/3/2 and leaves the last one half empty. Weighed and
                    declined (client 2026-07-29): ~34 characters shows the
                    common case and the field still scrolls past it. */}
                <Field label="Street" size="sm">
                  <Input
                    uppercase
                    value={b.street}
                    onChange={(e) => setBranchAt(b.key, { street: e.target.value })}
                  />
                </Field>
                <Field label="Land Line" size="sm">
                  <Input
                    value={b.land_line}
                    onChange={(e) => setBranchAt(b.key, { land_line: e.target.value })}
                  />
                </Field>
                {/* Both render their own labels, so the Field carries none.
                    WhatsApp's "Same as mobile" tick sits BELOW its input, so
                    this cell is ~18px taller and the row grows to match — that
                    is the grid stretching, not a bug to align away. */}
                <Field size="sm">
                  <MobileField
                    id={`bk-${b.key}-mobile`}
                    value={b.mobile}
                    onChange={(v) => setBranchAt(b.key, { mobile: v })}
                  />
                </Field>
                <Field size="sm">
                  <WhatsAppField
                    id={`bk-${b.key}-whatsapp`}
                    value={b.whatsapp}
                    mobile={b.mobile}
                    isdCode={isdOf.get(b.country_id) ?? null}
                    onChange={(v) => setBranchAt(b.key, { whatsapp: v })}
                  />
                </Field>

                {/* Row 3 — email and the three bank codes. */}
                <Field label="E-Mail" size="sm">
                  <ValidatedInput
                    format="email"
                    value={b.email}
                    onChange={(e) => setBranchAt(b.key, { email: e.target.value })}
                  />
                </Field>
                <Field label={codeLabel} size="sm">
                  <Input
                    uppercase
                    value={b.swift_rtgs_code}
                    onChange={(e) => setBranchAt(b.key, { swift_rtgs_code: e.target.value })}
                  />
                </Field>
                <Field label="IFS Code" size="sm">
                  <ValidatedInput
                    format="ifsc"
                    value={b.ifs_code}
                    onChange={(e) => setBranchAt(b.key, { ifs_code: e.target.value })}
                  />
                </Field>
                <Field label="Current Acc No" size="sm">
                  <ValidatedInput
                    format="account"
                    value={b.current_acc_no}
                    onChange={(e) => setBranchAt(b.key, { current_acc_no: e.target.value })}
                  />
                </Field>
              </FieldGrid>
            )}
          />
        </div>
      </Sheet>
    </div>
  );
}
