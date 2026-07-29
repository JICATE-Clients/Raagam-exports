"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Field, FieldGrid } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid, SectionColumn } from "@/components/masters/section-grid";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
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
        {/* Header LEFT, the Bank Detail branch grid RIGHT — a meaningful split,
            so SectionColumns rather than auto-placement (LAYOUT.md §1). */}
        <SectionGrid>
          <SectionColumn>
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
            <DetailSection label="Details" cols={12}>
              <Field label="Code" size="sm" htmlFor="bk-code">
                <Input
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
              <Field label="Type" size="md">
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
              {editId && (
                <Field size="md">
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
          </SectionColumn>

          <SectionColumn>
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
              renderMobileRow={(b) => (
                <FieldGrid>
                  <Field label="Country" size="lg">
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
                  <Field label="State" size="md">
                    <Input
                      value={b.state}
                      onChange={(e) => setBranchAt(b.key, { state: e.target.value })}
                    />
                  </Field>
                  <Field label="City" size="md">
                    <Input
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
                  <Field label="Street" size="full">
                    <Input
                      value={b.street}
                      onChange={(e) => setBranchAt(b.key, { street: e.target.value })}
                    />
                  </Field>
                  <Field label="Land Line" size="md">
                    <Input
                      value={b.land_line}
                      onChange={(e) => setBranchAt(b.key, { land_line: e.target.value })}
                    />
                  </Field>
                  {/* Both render their own labels, so the Field carries none. */}
                  <Field size="md">
                    <MobileField
                      id={`bk-${b.key}-mobile`}
                      value={b.mobile}
                      onChange={(v) => setBranchAt(b.key, { mobile: v })}
                    />
                  </Field>
                  {/* Full width: the "Same as mobile" tick needs a line of its own. */}
                  <Field size="full">
                    <WhatsAppField
                      id={`bk-${b.key}-whatsapp`}
                      value={b.whatsapp}
                      mobile={b.mobile}
                      isdCode={isdOf.get(b.country_id) ?? null}
                      onChange={(v) => setBranchAt(b.key, { whatsapp: v })}
                    />
                  </Field>
                  <Field label="E-Mail" size="lg">
                    <ValidatedInput
                      format="email"
                      value={b.email}
                      onChange={(e) => setBranchAt(b.key, { email: e.target.value })}
                    />
                  </Field>
                  <Field label={codeLabel} size="sm">
                    <Input
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
                  <Field label="Current Acc No" size="md">
                    <ValidatedInput
                      format="account"
                      value={b.current_acc_no}
                      onChange={(e) => setBranchAt(b.key, { current_acc_no: e.target.value })}
                    />
                  </Field>
                </FieldGrid>
              )}
            />
          </SectionColumn>
        </SectionGrid>
      </Sheet>
    </div>
  );
}
