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
  SPOUSE_TYPES,
  EMPLOYEE_TYPES,
  EMPLOYEE_TYPE_LABELS,
  MARITAL_STATUSES,
  SEXES,
  PAY_MODES,
  type Employee,
  type EmployeeInput,
  type EmployeeLocation,
  type EmployeeRef,
} from "@/lib/masters/employee-types";
import { DetailSection } from "@/components/masters/detail-section";
import { PhotoUpload } from "@/components/ui/photo-upload";
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
  photo_url: string | null;
  // personal
  email: string;
  qualification: string;
  blood_group: string;
  marital_status: string;
  sex: string;
  nationality: string;
  religion: string;
  // 0277 — employment & statutory
  doj: string;
  emp_type: string;
  mobile: string;
  father_name: string;
  mother_name: string;
  spouse_name: string;
  pf_no: string;
  esi_no: string;
  uan: string;
  pan_no: string;
  aadhar_no: string;
  pay_mode: string;
  bank_name: string;
  bank_acc_no: string;
  // 0279 — enrichment
  spouse_type: string;
  date_of_confirmation: string;
  date_of_filing: string;
  employee_type: string;
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
  photo_url: null,
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
  doj: "",
  emp_type: "",
  mobile: "",
  father_name: "",
  mother_name: "",
  spouse_name: "",
  pf_no: "",
  esi_no: "",
  uan: "",
  pan_no: "",
  aadhar_no: "",
  pay_mode: "Bank",
  bank_name: "",
  bank_acc_no: "",
  spouse_type: "",
  date_of_confirmation: "",
  date_of_filing: "",
  employee_type: "S",
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
      photo_url: r.photo_url ?? null,
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
      doj: r.doj ?? "",
      emp_type: r.emp_type ?? "",
      mobile: r.mobile ?? "",
      father_name: r.father_name ?? "",
      mother_name: r.mother_name ?? "",
      spouse_name: r.spouse_name ?? "",
      pf_no: r.pf_no ?? "",
      esi_no: r.esi_no ?? "",
      uan: r.uan ?? "",
      pan_no: r.pan_no ?? "",
      aadhar_no: r.aadhar_no ?? "",
      pay_mode: r.pay_mode ?? "Bank",
      bank_name: r.bank_name ?? "",
      bank_acc_no: r.bank_acc_no ?? "",
      spouse_type: r.spouse_type ?? "",
      date_of_confirmation: r.date_of_confirmation ?? "",
      date_of_filing: r.date_of_filing ?? "",
      employee_type: r.employee_type ?? "S",
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
        photo_url: form.photo_url,
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
        doj: form.doj || null,
        emp_type: form.emp_type.trim() || null,
        mobile: form.mobile.trim() || null,
        father_name: form.father_name.trim() || null,
        mother_name: form.mother_name.trim() || null,
        spouse_name: form.spouse_name.trim() || null,
        pf_no: form.pf_no.trim() || null,
        esi_no: form.esi_no.trim() || null,
        uan: form.uan.trim() || null,
        pan_no: form.pan_no.trim() || null,
        aadhar_no: form.aadhar_no.trim() || null,
        pay_mode: (form.pay_mode as EmployeeInput["pay_mode"]) || null,
        bank_name: form.bank_name.trim() || null,
        bank_acc_no: form.bank_acc_no.trim() || null,
        spouse_type: (form.spouse_type as EmployeeInput["spouse_type"]) || null,
        date_of_confirmation: form.date_of_confirmation || null,
        date_of_filing: form.date_of_filing || null,
        employee_type: (form.employee_type as EmployeeInput["employee_type"]) || "S",
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

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}

          {/* ---- Personal ---- */}
          <DetailSection label="Personal">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="emp-employee-type">Employee Type</Label>
                <Select
                  id="emp-employee-type"
                  value={form.employee_type}
                  onChange={(e) => set({ employee_type: e.target.value })}
                  className="text-base md:text-sm"
                >
                  {EMPLOYEE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EMPLOYEE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="emp-spouse-type">Spouse Type</Label>
                <Select
                  id="emp-spouse-type"
                  value={form.spouse_type}
                  onChange={(e) => set({ spouse_type: e.target.value })}
                  className="text-base md:text-sm"
                >
                  <option value="">— None —</option>
                  {SPOUSE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="emp-spouse-name">Spouse Name</Label>
                <Input
                  id="emp-spouse-name"
                  value={form.spouse_name}
                  onChange={(e) => set({ spouse_name: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-mobile">Mobile</Label>
                <ValidatedInput
                  id="emp-mobile"
                  format="mobile"
                  value={form.mobile}
                  onChange={(e) => set({ mobile: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="emp-father">Father Name</Label>
                <Input
                  id="emp-father"
                  value={form.father_name}
                  onChange={(e) => set({ father_name: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-mother">Mother Name</Label>
                <Input
                  id="emp-mother"
                  value={form.mother_name}
                  onChange={(e) => set({ mother_name: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </DetailSection>

          {/* ---- Dates ---- */}
          <DetailSection label="Dates">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="emp-doj">Date of Joining</Label>
                <Input
                  id="emp-doj"
                  type="date"
                  value={form.doj}
                  onChange={(e) => set({ doj: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-doc">Date of Confirmation</Label>
                <Input
                  id="emp-doc"
                  type="date"
                  value={form.date_of_confirmation}
                  onChange={(e) => set({ date_of_confirmation: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-dof">Date of Filing</Label>
                <Input
                  id="emp-dof"
                  type="date"
                  value={form.date_of_filing}
                  onChange={(e) => set({ date_of_filing: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </DetailSection>

          {/* ---- Statutory IDs ---- */}
          <DetailSection label="Statutory IDs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="emp-pf">PF No</Label>
                <Input
                  id="emp-pf"
                  value={form.pf_no}
                  onChange={(e) => set({ pf_no: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-esi">ESI No</Label>
                <Input
                  id="emp-esi"
                  value={form.esi_no}
                  onChange={(e) => set({ esi_no: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-uan">UAN</Label>
                <Input
                  id="emp-uan"
                  value={form.uan}
                  onChange={(e) => set({ uan: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-pan">PAN No</Label>
                <Input
                  id="emp-pan"
                  value={form.pan_no}
                  onChange={(e) => set({ pan_no: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-aadhar">Aadhar No</Label>
                <Input
                  id="emp-aadhar"
                  value={form.aadhar_no}
                  onChange={(e) => set({ aadhar_no: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </DetailSection>

          {/* ---- Bank Details ---- */}
          <DetailSection label="Bank Details">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="emp-paymode">Pay Mode</Label>
                <Select
                  id="emp-paymode"
                  value={form.pay_mode}
                  onChange={(e) => set({ pay_mode: e.target.value })}
                  className="text-base md:text-sm"
                >
                  {PAY_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="emp-bankname">Bank Name</Label>
                <Input
                  id="emp-bankname"
                  value={form.bank_name}
                  onChange={(e) => set({ bank_name: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="emp-bankacc">Account No</Label>
                <Input
                  id="emp-bankacc"
                  value={form.bank_acc_no}
                  onChange={(e) => set({ bank_acc_no: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </DetailSection>

          {/* Photo */}
          <DetailSection label="Photo">
            <PhotoUpload
              value={form.photo_url}
              onChange={(url) => set({ photo_url: url })}
              disabled={!perms.canEdit}
            />
          </DetailSection>

          {/* ---- General ---- */}
          <DetailSection label="General">
            <div className="space-y-4">
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
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
