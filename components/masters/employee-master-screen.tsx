"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { LocationPicker } from "@/components/masters/location-picker";
import { EmployeePicker } from "@/components/masters/employee-picker";
import { createEmployee, updateEmployee, deleteEmployee } from "@/lib/masters/employee-actions";
import {
  GUARDIAN_RELATIONS,
  MARITAL_STATUSES,
  SEXES,
  type Employee,
  type EmployeeInput,
  type EmployeeLocation,
  type EmployeeRef,
} from "@/lib/masters/employee-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = {
  code: string;
  name: string;
  guardian_relation: string;
  guardian_name: string;
  category_id: string;
  department_id: string;
  location_id: string;
  designation_id: string;
  team_id: string;
  manager_id: string;
  dob: string;
  inactive: boolean;
  // Permanent Address
  perm_addr1: string;
  perm_addr2: string;
  perm_addr3: string;
  perm_pin: string;
  perm_phone: string;
  perm_mobile: string;
  // Correspondence Address
  corr_same_as_perm: boolean;
  corr_addr1: string;
  corr_addr2: string;
  corr_addr3: string;
  corr_pin: string;
  corr_phone: string;
  corr_mobile: string;
  // personal
  email: string;
  qualification: string;
  blood_group: string;
  marital_status: string;
  sex: string;
  nationality: string;
  religion: string;
};
const BLANK: Form = {
  code: "",
  name: "",
  guardian_relation: "S/O",
  guardian_name: "",
  category_id: "",
  department_id: "",
  location_id: "",
  designation_id: "",
  team_id: "",
  manager_id: "",
  dob: "",
  inactive: false,
  perm_addr1: "",
  perm_addr2: "",
  perm_addr3: "",
  perm_pin: "",
  perm_phone: "",
  perm_mobile: "",
  corr_same_as_perm: false,
  corr_addr1: "",
  corr_addr2: "",
  corr_addr3: "",
  corr_pin: "",
  corr_phone: "",
  corr_mobile: "",
  email: "",
  qualification: "",
  blood_group: "",
  marital_status: "Single",
  sex: "Male",
  nationality: "",
  religion: "",
};

/** Whole-year age from a YYYY-MM-DD DOB string (legacy shows an auto Age box). */
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * CRUD for the legacy "Employee" master (Associates). A flat (single-row)
 * record: a header (ID · Name · guardian · Category/Department/Location/
 * Designation/Team ⓘ pickers · DOB+Age · Manager ⓘ · Inactive) + a General
 * panel (Permanent + Correspondence addresses · personal details).
 *
 * Every ⓘ field lists stored data: Category/Department/Designation/Team via the
 * shared LookupDialogPicker (config_lookups, with Add/Modify); Location via the
 * locations master and Manager via the employees master (both select-only).
 */
export function EmployeeMasterScreen({
  rows,
  categories,
  departments,
  designations,
  teams,
  locations,
  perms,
}: {
  rows: Employee[];
  categories: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  teams: ConfigLookup[];
  locations: EmployeeLocation[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const managerPool: EmployeeRef[] = useMemo(
    () => rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    [rows],
  );
  const deptLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) m.set(d.id, d.name);
    return m;
  }, [departments]);
  const desigLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of designations) m.set(d.id, d.name);
    return m;
  }, [designations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Employee) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      guardian_relation: r.guardian_relation ?? "S/O",
      guardian_name: r.guardian_name ?? "",
      category_id: r.category_id ?? "",
      department_id: r.department_id ?? "",
      location_id: r.location_id ?? "",
      designation_id: r.designation_id ?? "",
      team_id: r.team_id ?? "",
      manager_id: r.manager_id ?? "",
      dob: r.dob ?? "",
      inactive: r.inactive,
      perm_addr1: r.perm_addr1 ?? "",
      perm_addr2: r.perm_addr2 ?? "",
      perm_addr3: r.perm_addr3 ?? "",
      perm_pin: r.perm_pin ?? "",
      perm_phone: r.perm_phone ?? "",
      perm_mobile: r.perm_mobile ?? "",
      corr_same_as_perm: r.corr_same_as_perm,
      corr_addr1: r.corr_addr1 ?? "",
      corr_addr2: r.corr_addr2 ?? "",
      corr_addr3: r.corr_addr3 ?? "",
      corr_pin: r.corr_pin ?? "",
      corr_phone: r.corr_phone ?? "",
      corr_mobile: r.corr_mobile ?? "",
      email: r.email ?? "",
      qualification: r.qualification ?? "",
      blood_group: r.blood_group ?? "",
      marital_status: r.marital_status ?? "Single",
      sex: r.sex ?? "Male",
      nationality: r.nationality ?? "",
      religion: r.religion ?? "",
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const sameCorr = form.corr_same_as_perm;
      const payload: EmployeeInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        guardian_relation: (form.guardian_relation as EmployeeInput["guardian_relation"]) || null,
        guardian_name: form.guardian_name.trim() || null,
        category_id: form.category_id || null,
        department_id: form.department_id || null,
        location_id: form.location_id || null,
        designation_id: form.designation_id || null,
        team_id: form.team_id || null,
        manager_id: form.manager_id || null,
        dob: form.dob || null,
        inactive: form.inactive,
        photo_url: null,
        perm_addr1: form.perm_addr1.trim() || null,
        perm_addr2: form.perm_addr2.trim() || null,
        perm_addr3: form.perm_addr3.trim() || null,
        perm_pin: form.perm_pin.trim() || null,
        perm_phone: form.perm_phone.trim() || null,
        perm_mobile: form.perm_mobile.trim() || null,
        corr_same_as_perm: sameCorr,
        corr_addr1: (sameCorr ? form.perm_addr1 : form.corr_addr1).trim() || null,
        corr_addr2: (sameCorr ? form.perm_addr2 : form.corr_addr2).trim() || null,
        corr_addr3: (sameCorr ? form.perm_addr3 : form.corr_addr3).trim() || null,
        corr_pin: (sameCorr ? form.perm_pin : form.corr_pin).trim() || null,
        corr_phone: (sameCorr ? form.perm_phone : form.corr_phone).trim() || null,
        corr_mobile: (sameCorr ? form.perm_mobile : form.corr_mobile).trim() || null,
        email: form.email.trim() || null,
        qualification: form.qualification.trim() || null,
        blood_group: form.blood_group.trim() || null,
        marital_status: (form.marital_status as EmployeeInput["marital_status"]) || null,
        sex: (form.sex as EmployeeInput["sex"]) || null,
        nationality: form.nationality.trim() || null,
        religion: form.religion.trim() || null,
        is_draft: asDraft,
      };
      const res = editId ? await updateEmployee(editId, payload) : await createEmployee(payload);
      if (res.ok) {
        success(editId ? "Employee updated." : "Employee added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Employee) {
    startTransition(async () => {
      const res = await deleteEmployee(r.id);
      if (res.ok) {
        success("Employee deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Employee>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Designation",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.designation_id ? (desigLabel.get(r.designation_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Department",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.department_id ? (deptLabel.get(r.department_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        const tone = r.is_draft ? "warning" : r.inactive ? "danger" : "success";
        const text = r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active";
        return <StatusPill tone={tone}>{text}</StatusPill>;
      },
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const age = ageFromDob(form.dob);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Employee
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No employees yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No employees yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.designation_id ? ` · ${desigLabel.get(r.designation_id) ?? ""}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
                  {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Employee" : "New Employee"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {perms.canCreate && (
              <Button
                variant="outline"
                size="md"
                disabled={isPending || !form.name.trim()}
                onClick={() => submit(true)}
              >
                Save as Draft
              </Button>
            )}
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* ---- Header ---- */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="emp-code">ID</Label>
              <Input
                id="emp-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label>Category</Label>
              <LookupDialogPicker
                kind="employee_category"
                label="Category"
                options={categories}
                value={form.category_id || null}
                onChange={(id) => set({ category_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
              />
            </div>
          </div>

          <div>
            <Label htmlFor="emp-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="emp-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>

          {/* Guardian (S/O …) */}
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <div>
              <Label htmlFor="emp-grel">Relation</Label>
              <Select
                id="emp-grel"
                value={form.guardian_relation}
                onChange={(e) => set({ guardian_relation: e.target.value })}
                className="text-base md:text-sm"
              >
                {GUARDIAN_RELATIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="emp-gname">Guardian Name</Label>
              <Input
                id="emp-gname"
                value={form.guardian_name}
                onChange={(e) => set({ guardian_name: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Department</Label>
              <LookupDialogPicker
                kind="department"
                label="Department"
                options={departments}
                value={form.department_id || null}
                onChange={(id) => set({ department_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
              />
            </div>
            <div>
              <Label>Designation</Label>
              <LookupDialogPicker
                kind="designation"
                label="Designation"
                options={designations}
                value={form.designation_id || null}
                onChange={(id) => set({ designation_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
              />
            </div>
            <div>
              <Label>Location</Label>
              <LocationPicker
                locations={locations}
                value={form.location_id || null}
                onChange={(id) => set({ location_id: id ?? "" })}
                compact
              />
            </div>
            <div>
              <Label>Team</Label>
              <LookupDialogPicker
                kind="team"
                label="Team"
                options={teams}
                value={form.team_id || null}
                onChange={(id) => set({ team_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div>
              <Label htmlFor="emp-dob">DOB</Label>
              <Input
                id="emp-dob"
                type="date"
                value={form.dob}
                onChange={(e) => set({ dob: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="emp-age">Age</Label>
              <Input id="emp-age" value={age ?? ""} readOnly className="text-base md:text-sm" />
            </div>
          </div>

          <div>
            <Label>Manager</Label>
            <EmployeePicker
              employees={managerPool}
              value={form.manager_id || null}
              onChange={(id) => set({ manager_id: id ?? "" })}
              excludeId={editId}
              compact
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>

          {/* Photo — upload deferred; field reserved. */}
          <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-4 py-4 text-center text-xs text-muted-foreground">
            Photo upload — coming soon.
          </div>

          {/* ---- General ---- */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              General
            </div>
            <div className="space-y-4 p-3">
              {/* Permanent Address */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Permanent Address</p>
                <Input
                  placeholder="Address line 1"
                  value={form.perm_addr1}
                  onChange={(e) => set({ perm_addr1: e.target.value })}
                  className="text-base md:text-sm"
                />
                <Input
                  placeholder="Address line 2"
                  value={form.perm_addr2}
                  onChange={(e) => set({ perm_addr2: e.target.value })}
                  className="text-base md:text-sm"
                />
                <Input
                  placeholder="Address line 3"
                  value={form.perm_addr3}
                  onChange={(e) => set({ perm_addr3: e.target.value })}
                  className="text-base md:text-sm"
                />
                <div className="grid grid-cols-3 gap-2">
                  <ValidatedInput
                    format="pincode"
                    placeholder="Pin"
                    value={form.perm_pin}
                    onChange={(e) => set({ perm_pin: e.target.value })}
                    className="text-base md:text-sm"
                  />
                  <Input
                    placeholder="Ph"
                    value={form.perm_phone}
                    onChange={(e) => set({ perm_phone: e.target.value })}
                    className="text-base md:text-sm"
                  />
                  <ValidatedInput
                    format="mobile"
                    placeholder="Mobile"
                    value={form.perm_mobile}
                    onChange={(e) => set({ perm_mobile: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>

              {/* Correspondence Address */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Correspondence Address</p>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 cursor-pointer accent-primary"
                      checked={form.corr_same_as_perm}
                      onChange={(e) => set({ corr_same_as_perm: e.target.checked })}
                    />
                    <span className="text-xs text-foreground">Same as Permanent</span>
                  </label>
                </div>
                {form.corr_same_as_perm ? (
                  <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
                    Uses the permanent address.
                  </p>
                ) : (
                  <>
                    <Input
                      placeholder="Address line 1"
                      value={form.corr_addr1}
                      onChange={(e) => set({ corr_addr1: e.target.value })}
                      className="text-base md:text-sm"
                    />
                    <Input
                      placeholder="Address line 2"
                      value={form.corr_addr2}
                      onChange={(e) => set({ corr_addr2: e.target.value })}
                      className="text-base md:text-sm"
                    />
                    <Input
                      placeholder="Address line 3"
                      value={form.corr_addr3}
                      onChange={(e) => set({ corr_addr3: e.target.value })}
                      className="text-base md:text-sm"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <ValidatedInput
                        format="pincode"
                        placeholder="Pin"
                        value={form.corr_pin}
                        onChange={(e) => set({ corr_pin: e.target.value })}
                        className="text-base md:text-sm"
                      />
                      <Input
                        placeholder="Ph"
                        value={form.corr_phone}
                        onChange={(e) => set({ corr_phone: e.target.value })}
                        className="text-base md:text-sm"
                      />
                      <ValidatedInput
                        format="mobile"
                        placeholder="Mobile"
                        value={form.corr_mobile}
                        onChange={(e) => set({ corr_mobile: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </>
                )}
              </div>

              <div>
                <Label htmlFor="emp-email">E-Mail</Label>
                <ValidatedInput
                  id="emp-email"
                  format="email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="emp-qual">Qualification</Label>
                  <Input
                    id="emp-qual"
                    value={form.qualification}
                    onChange={(e) => set({ qualification: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-blood">Blood Group</Label>
                  <Input
                    id="emp-blood"
                    value={form.blood_group}
                    onChange={(e) => set({ blood_group: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>

              {/* Marital Status */}
              <div>
                <Label>Marital Status</Label>
                <div className="mt-1 flex flex-wrap gap-4">
                  {MARITAL_STATUSES.map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="emp-marital"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.marital_status === m}
                        onChange={() => set({ marital_status: m })}
                      />
                      <span className="text-sm text-foreground">{m}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Sex */}
              <div>
                <Label>Sex</Label>
                <div className="mt-1 flex flex-wrap gap-4">
                  {SEXES.map((sx) => (
                    <label key={sx} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="emp-sex"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.sex === sx}
                        onChange={() => set({ sex: sx })}
                      />
                      <span className="text-sm text-foreground">{sx}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="emp-nat">Nationality</Label>
                  <Input
                    id="emp-nat"
                    value={form.nationality}
                    onChange={(e) => set({ nationality: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="emp-rel">Religion</Label>
                  <Input
                    id="emp-rel"
                    value={form.religion}
                    onChange={(e) => set({ religion: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
