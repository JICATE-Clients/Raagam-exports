"use client";

import { CirclePause, CirclePlay, CircleStop, Users } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtMoney } from "@/lib/format";
import { deleteJob, saveJob, setJobStatus } from "@/lib/hr/recruitment-actions";
import {
  designationFits,
  recruitmentLabel,
  recruitmentTone,
  type DesignationOption,
  type HiresAs,
  type Job,
  type JobStatus,
  type Option,
  type SalaryBasis,
} from "@/lib/hr/recruitment-types";
import { ReasonSheet } from "@/components/hr/timeoff/shared";

/**
 * HR ▸ Recruitment ▸ Job Openings (0772, MyJKKN §7 jobs).
 *
 * A job belongs to the unit it was raised in. Candidates are added only while
 * it is Open; when as many have joined as it has openings it fills itself.
 * MyJKKN's job had no transition map — any status to any — and a draft's
 * Publish was unreachable; here the row's own icons move it (Open, Hold,
 * Close with a reason) and a job with candidates is closed, never deleted.
 */

type Props = {
  rows: Job[];
  departments: Option[];
  designations: DesignationOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Draft = {
  title: string;
  department_id: string;
  designation_id: string;
  hires_as: HiresAs;
  openings: string;
  salary_basis: SalaryBasis;
  salary_min: string;
  salary_max: string;
  experience_min: string;
  experience_max: string;
  qualification: string;
  description: string;
  needed_by: string;
  status: JobStatus;
};
const BLANK: Draft = {
  title: "",
  department_id: "",
  designation_id: "",
  hires_as: "workers",
  openings: "1",
  salary_basis: "daily",
  salary_min: "",
  salary_max: "",
  experience_min: "",
  experience_max: "",
  qualification: "",
  description: "",
  needed_by: "",
  status: "open",
};
const s = (n: number | null) => (n == null ? "" : String(n));

function salaryRange(j: Job): string {
  if (j.salary_min == null && j.salary_max == null) return "—";
  const unit = j.salary_basis === "daily" ? " / day" : " / month";
  if (j.salary_min != null && j.salary_max != null && j.salary_min !== j.salary_max)
    return `${fmtMoney(j.salary_min)} – ${fmtMoney(j.salary_max)}${unit}`;
  return `${fmtMoney((j.salary_max ?? j.salary_min) as number)}${unit}`;
}

export function JobsScreen({ rows, departments, designations, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [scope, setScope] = useState<"live" | "done" | "all">("live");
  const visible = useMemo(
    () =>
      scope === "live"
        ? rows.filter((r) => r.status === "open" || r.status === "draft" || r.status === "on_hold")
        : scope === "done"
          ? rows.filter((r) => r.status === "closed" || r.status === "filled")
          : rows,
    [rows, scope],
  );

  // ── editor ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(BLANK);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openEdit(j?: Job) {
    setEditId(j?.id ?? null);
    setD(
      j
        ? {
            title: j.title,
            department_id: j.department_id ?? "",
            designation_id: j.designation_id ?? "",
            hires_as: j.hires_as,
            openings: String(j.openings),
            salary_basis: j.salary_basis,
            salary_min: s(j.salary_min),
            salary_max: s(j.salary_max),
            experience_min: s(j.experience_min),
            experience_max: s(j.experience_max),
            qualification: j.qualification ?? "",
            description: j.description ?? "",
            needed_by: j.needed_by ?? "",
            status: j.status,
          }
        : BLANK,
    );
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openEdit());

  const deptOptions = departments.filter((o) => !o.inactive || o.id === d.department_id);
  const desigOptions = designations.filter(
    (o) => (designationFits(o, d.hires_as) && !o.inactive) || o.id === d.designation_id,
  );
  const problem = !d.title.trim()
    ? "The job title is mandatory"
    : !(Number(d.openings) >= 1)
      ? "At least one opening"
      : d.salary_min && d.salary_max && Number(d.salary_max) < Number(d.salary_min)
        ? "The top of the salary range is below the bottom"
        : null;

  function save() {
    const payload = {
      ...d,
      department_id: d.department_id || null,
      designation_id: d.designation_id || null,
      salary_min: d.salary_min || null,
      salary_max: d.salary_max || null,
      experience_min: d.experience_min || null,
      experience_max: d.experience_max || null,
      needed_by: d.needed_by || null,
      close_reason: null,
    };
    startTransition(async () => {
      const r = await saveJob(editId, payload);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? "Job saved" : "Job added");
      router.refresh();
    });
  }

  const [closing, setClosing] = useState<Job | null>(null);
  function move(j: Job, status: "open" | "on_hold" | "closed", reason = "") {
    startTransition(async () => {
      const r = await setJobStatus(j.id, status, reason);
      if (!r.ok) toastError(r.error);
      else {
        success(status === "open" ? "Job opened" : status === "on_hold" ? "Job on hold" : "Job closed");
        setClosing(null);
        router.refresh();
      }
    });
  }

  const columns: Column<Job>[] = [
    { header: "Code", cell: (j) => <span className="font-mono text-xs font-medium">{j.code ?? "—"}</span> },
    {
      header: "Job",
      cell: (j) => (
        <span className="text-sm">
          <span className="font-medium">{j.title}</span>
          {j.department_name && <span className="ml-2 text-xs text-muted-foreground">{j.department_name}</span>}
        </span>
      ),
    },
    { header: "Hires", cell: (j) => <span className="text-sm">{j.hires_as === "staff" ? "Staff" : "Workers"}</span> },
    { header: "Salary", cell: (j) => <span className="text-sm tabular-nums">{salaryRange(j)}</span> },
    { header: "Needed By", cell: (j) => <span className="text-sm tabular-nums">{j.needed_by ? fmtDate(j.needed_by) : "—"}</span> },
    {
      header: "Candidates",
      cell: (j) => (
        <span className="text-sm tabular-nums">
          {j.counts.active} in progress
          <span className="ml-2 text-xs text-muted-foreground">
            · {j.counts.joined} / {j.openings} joined
          </span>
        </span>
      ),
    },
  ];
  const statusColumn: Column<Job> = {
    header: "Status",
    cell: (j) => <StatusPill tone={recruitmentTone(j.status)}>{recruitmentLabel(j.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Job>((j) => (
    <RowActions
      label={j.title}
      view={false}
      onEdit={() => openEdit(j)}
      canEdit={canEdit}
      onDelete={() =>
        startTransition(async () => {
          const r = await deleteJob(j.id);
          if (!r.ok) toastError(r.error);
          else {
            success("Deleted");
            router.refresh();
          }
        })
      }
      canDelete={canDelete}
      deleteDisabledReason={j.counts.total > 0 ? "This job has candidates — close it instead" : null}
      isPending={isPending}
      menu={[
        {
          label: "Candidates",
          icon: Users,
          onClick: () => router.push(`/hr/recruitment/candidates?job=${j.id}`),
        },
        ...(canEdit && (j.status === "draft" || j.status === "on_hold" || j.status === "closed")
          ? [{ label: "Open", icon: CirclePlay, onClick: () => move(j, "open") }]
          : []),
        ...(canEdit && j.status === "open" ? [{ label: "Put on hold", icon: CirclePause, onClick: () => move(j, "on_hold") }] : []),
        ...(canEdit && (j.status === "open" || j.status === "on_hold" || j.status === "draft")
          ? [{ label: "Close…", icon: CircleStop, onClick: () => setClosing(j) }]
          : []),
      ]}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "live", label: "Open & draft" },
            { value: "done", label: "Closed & filled" },
            { value: "all", label: "All" },
          ]}
        />
        {canCreate && <Button onClick={() => openEdit()}>+ Add Job</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(j) => j.id}
        empty={scope === "live" ? "No open jobs. Add one to start taking candidates." : "No jobs here."}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.title}` : "New job opening"}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        {/* 288 title + 176 dept + 176 designation + gaps ≈ 680px → cap 48rem */}
        <div className="max-w-[48rem] space-y-5">
          <FieldRow>
            <Field label="Job title" w="name" required>
              <Input value={d.title} onChange={(e) => put({ title: e.target.value })} />
            </Field>
            <Field label="Department" w="term">
              <Select value={d.department_id} onChange={(e) => put({ department_id: e.target.value })}>
                <option value="" />
                {deptOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Hires as">
              <Segmented
                name="job-hires-as"
                value={d.hires_as}
                onChange={(v) =>
                  put({
                    hires_as: v,
                    salary_basis: v === "staff" ? "monthly" : d.salary_basis,
                    designation_id: designations.some((o) => o.id === d.designation_id && designationFits(o, v)) ? d.designation_id : "",
                  })
                }
                options={[
                  { value: "workers", label: "Workers" },
                  { value: "staff", label: "Staff" },
                ]}
              />
            </Field>
            <Field label="Designation" w="term">
              <Select value={d.designation_id} onChange={(e) => put({ designation_id: e.target.value })}>
                <option value="" />
                {desigOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Openings" w="num" required>
              <Input type="number" min="1" max="500" value={d.openings} onChange={(e) => put({ openings: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Pay">
              <Segmented
                name="job-basis"
                value={d.salary_basis}
                onChange={(v) => put({ salary_basis: v })}
                options={[
                  { value: "daily", label: "Daily wage" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </Field>
            <Field label="From (₹)" w="num">
              <Input type="number" min="0" value={d.salary_min} onChange={(e) => put({ salary_min: e.target.value })} />
            </Field>
            <Field label="To (₹)" w="num">
              <Input type="number" min="0" value={d.salary_max} onChange={(e) => put({ salary_max: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Experience from (yrs)" w="num">
              <Input type="number" min="0" step="0.5" value={d.experience_min} onChange={(e) => put({ experience_min: e.target.value })} />
            </Field>
            <Field label="to (yrs)" w="num">
              <Input type="number" min="0" step="0.5" value={d.experience_max} onChange={(e) => put({ experience_max: e.target.value })} />
            </Field>
            <Field label="Needed by" w="code">
              <Input type="date" value={d.needed_by} onChange={(e) => put({ needed_by: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="Qualification">
            <Input value={d.qualification} onChange={(e) => put({ qualification: e.target.value })} />
          </Field>
          <Field label="About the job">
            <Textarea rows={3} value={d.description} onChange={(e) => put({ description: e.target.value })} />
          </Field>
          {!editId && (
            <Field label="Start as">
              <Segmented
                name="job-status"
                value={d.status}
                onChange={(v) => put({ status: v })}
                options={[
                  { value: "open", label: "Open — take candidates now" },
                  { value: "draft", label: "Draft" },
                ]}
              />
            </Field>
          )}
        </div>
      </Sheet>

      <ReasonSheet
        open={!!closing}
        busy={isPending}
        onClose={() => setClosing(null)}
        onConfirm={(reason) => closing && move(closing, "closed", reason)}
        title={`Close ${closing?.code ?? ""}`}
        confirmLabel="Close job"
        intro="No more candidates can be added. Candidates already in progress stay as they are."
      />
    </div>
  );
}
