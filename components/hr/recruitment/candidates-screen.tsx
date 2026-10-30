"use client";

import { BadgeCheck, CalendarPlus, FileText, Send, UserCheck, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { SelectionBar } from "@/components/ui/selection-bar";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { createClient } from "@/lib/supabase/client";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import {
  addCandidateNote,
  deleteCandidate,
  discardResumeUpload,
  loadCandidateDetail,
  loadHirePanel,
  markJoined,
  moveCandidates,
  recallSelection,
  resumeLink,
  saveCandidate,
  submitSelection,
} from "@/lib/hr/recruitment-actions";
import {
  LIVE_STATUSES,
  MODE_LABELS,
  RECOMMENDATION_LABELS,
  RESUME_ACCEPT,
  RESUME_BUCKET,
  RESUME_MAX_BYTES,
  SOURCES,
  SOURCE_LABELS,
  canMove,
  candidateProblem,
  designationFits,
  moveNeedsNote,
  recruitmentLabel,
  recruitmentTone,
  scoreOf,
  type Candidate,
  type CandidateDraft,
  type CandidateEvent,
  type CandidateStatus,
  type DesignationOption,
  type Interview,
  type Job,
  type MoveTo,
  type SalaryBasis,
  type SelectionDraft,
  type Source,
} from "@/lib/hr/recruitment-types";
import type { ChecklistTemplate } from "@/lib/hr/lifecycle-types";
import { appliesToPerson } from "@/lib/hr/lifecycle-types";
import type { PersonOption } from "@/lib/hr/timeoff-types";
import { Fact, ReasonSheet } from "@/components/hr/timeoff/shared";
import { PersonCombobox } from "@/components/hr/lifecycle/shared";
import { ScheduleSheet, ScoreBadge } from "./shared";

/**
 * HR ▸ Recruitment ▸ Candidates (0772, MyJKKN §7 applications + candidates).
 *
 * One record carries a person from first contact to joining:
 *
 *   New → Shortlisted → Interview (rounds, each with the panel's marks)
 *       → Send for approval (designation, salary, joining date) → Approved
 *       → Offered → Joined (linked to the staff / worker record made on People,
 *         and a Joining Checklist started if wanted)
 *
 * with Rejected / Withdrawn / Offer declined / No show beside it. MyJKKN kept
 * an application and a candidate as two records joined by a jsonb key, and
 * approved the package separately after the chain; here the offer IS what the
 * approver approves, and a counter-offer is a revised offer sent again.
 * Every move, with its note, lands on the candidate's timeline.
 */

type Props = {
  rows: Candidate[];
  jobs: Job[];
  designations: DesignationOption[];
  people: PersonOption[];
  templates: ChecklistTemplate[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Scope = "live" | "new" | "interview" | "selected" | "joined" | "closed" | "all";
const CLOSED: CandidateStatus[] = ["rejected", "withdrawn", "offer_declined", "no_show"];
const SELECTED: CandidateStatus[] = ["pending_approval", "approved", "offered"];
const REVISING: CandidateStatus[] = ["approved", "offered", "offer_declined"];
function inScope(c: Candidate, s: Scope): boolean {
  if (s === "all") return true;
  if (s === "live") return LIVE_STATUSES.includes(c.status);
  if (s === "new") return c.status === "new" || c.status === "shortlisted";
  if (s === "interview") return c.status === "interview";
  if (s === "selected") return SELECTED.includes(c.status);
  if (s === "joined") return c.status === "joined";
  return CLOSED.includes(c.status);
}

const blankDraft = (jobId = ""): CandidateDraft => ({
  job_id: jobId,
  name: "",
  phone: "",
  email: "",
  gender: "",
  date_of_birth: "",
  town: "",
  qualification: "",
  experience_years: "",
  current_employer: "",
  current_salary: "",
  expected_salary: "",
  notice_days: "",
  source: "walk_in",
  referred_by_staff_id: "",
  source_note: "",
  notes: "",
  resume_path: "",
  resume_name: "",
});
const s = (n: number | null) => (n == null ? "" : String(n));

const MOVE_WORDS: Record<MoveTo, { title: string; button: string; intro: string }> = {
  shortlisted: { title: "Reconsider", button: "Back to shortlist", intro: "They go back on the shortlist." },
  rejected: { title: "Reject", button: "Reject", intro: "They stay on record as rejected for this job." },
  withdrawn: { title: "Withdrawn", button: "Mark withdrawn", intro: "The candidate pulled out." },
  offered: { title: "Offer given", button: "Offer given", intro: "" },
  offer_declined: { title: "Offer declined", button: "Mark declined", intro: "They turned the offer down. A revised offer can still be sent." },
  no_show: { title: "Did not join", button: "Mark no-show", intro: "They accepted but did not come on the joining day." },
};

function basisWord(b: SalaryBasis | null): string {
  return b === "daily" ? " / day" : " / month";
}

export function CandidatesScreen({ rows, jobs, designations, people, templates, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const staff = useMemo(() => people.filter((p) => p.kind === "staff"), [people]);
  const openJobs = jobs.filter((j) => j.status === "open");

  // ── filters ──
  const [scope, setScope] = useState<Scope>("live");
  const [jobFilter, setJobFilter] = useState(() => params.get("job") ?? "");
  const visible = useMemo(
    () => rows.filter((c) => inScope(c, scope) && (!jobFilter || c.job_id === jobFilter)),
    [rows, scope, jobFilter],
  );
  const count = (sc: Scope) => rows.filter((c) => inScope(c, sc) && (!jobFilter || c.job_id === jobFilter)).length;

  // ── bulk ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = visible.filter((c) => selected.has(c.id));

  // ── add / edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<CandidateDraft>(() => blankDraft());
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<CandidateDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openEdit(c?: Candidate) {
    setEditId(c?.id ?? null);
    setD(
      c
        ? {
            job_id: c.job_id,
            name: c.name,
            phone: c.phone,
            email: c.email ?? "",
            gender: c.gender ?? "",
            date_of_birth: c.date_of_birth ?? "",
            town: c.town ?? "",
            qualification: c.qualification ?? "",
            experience_years: s(c.experience_years),
            current_employer: c.current_employer ?? "",
            current_salary: s(c.current_salary),
            expected_salary: s(c.expected_salary),
            notice_days: s(c.notice_days),
            source: c.source,
            referred_by_staff_id: c.referred_by_staff_id ?? "",
            source_note: c.source_note ?? "",
            notes: c.notes ?? "",
            resume_path: "",
            resume_name: "",
          }
        : blankDraft(jobFilter && openJobs.some((j) => j.id === jobFilter) ? jobFilter : (openJobs.length === 1 ? openJobs[0].id : "")),
    );
    setFile(null);
    setFileKey((k) => k + 1);
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openEdit());
  const problem = candidateProblem(d);

  function save() {
    const job = jobs.find((j) => j.id === d.job_id);
    if (file) {
      if (!RESUME_ACCEPT.split(",").includes(file.type)) {
        toastError("The résumé must be a PDF, Word file, JPEG or PNG");
        return;
      }
      if (file.size > RESUME_MAX_BYTES) {
        toastError("The résumé is over 5 MB");
        return;
      }
    }
    startTransition(async () => {
      let draft = d;
      if (file && job) {
        const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
        const path = `${job.location_id}/${job.id}/${crypto.randomUUID()}.${ext}`;
        const up = await createClient().storage.from(RESUME_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
        if (up.error) {
          toastError(`Upload failed — ${up.error.message}`);
          return;
        }
        draft = { ...d, resume_path: path, resume_name: file.name };
      }
      const r = await saveCandidate(editId, draft);
      if (!r.ok) {
        // A replaced résumé on an edit is not cleaned by the action; do it here.
        if (editId && draft.resume_path) await discardResumeUpload(draft.resume_path);
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? "Candidate saved" : "Candidate added");
      router.refresh();
    });
  }

  // ── view ──
  const [viewFor, setViewFor] = useState<Candidate | null>(null);
  const [detail, setDetail] = useState<{ id: string; events: CandidateEvent[]; interviews: Interview[] } | null>(null);
  const [panel, setPanel] = useState<(Awaited<ReturnType<typeof loadHirePanel>> & { id: string }) | null>(null);
  const [note, setNote] = useState("");
  function refreshDetail(id: string) {
    loadCandidateDetail(id).then((x) => setDetail({ id, ...x }));
    loadHirePanel(id).then((p) => setPanel({ ...p, id }));
  }
  function openView(c: Candidate) {
    setViewFor(c);
    setNote("");
    refreshDetail(c.id);
  }
  useOpenIntent((id) => {
    const c = rows.find((x) => x.id === id);
    if (c) openView(c);
  });
  const live = viewFor ? (rows.find((r) => r.id === viewFor.id) ?? viewFor) : null;
  const liveDetail = live && detail?.id === live.id ? detail : null;

  function openResume(path: string) {
    startTransition(async () => {
      const r = await resumeLink(path);
      if (r.ok) window.open(r.url, "_blank", "noopener");
      else toastError(r.error);
    });
  }
  function saveNote() {
    if (!live) return;
    const id = live.id;
    startTransition(async () => {
      const r = await addCandidateNote(id, note);
      if (!r.ok) toastError(r.error);
      else {
        setNote("");
        refreshDetail(id);
      }
    });
  }

  // ── moves ──
  const [moving, setMoving] = useState<{ ids: string[]; to: MoveTo; names: string } | null>(null);
  function doMove(ids: string[], to: MoveTo, reason: string) {
    startTransition(async () => {
      const r = await moveCandidates(ids, to, reason);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(`${r.count ?? ids.length} moved to ${recruitmentLabel(to).toLowerCase()}`);
      setMoving(null);
      setSelected(new Set());
      if (live && ids.includes(live.id)) refreshDetail(live.id);
      router.refresh();
    });
  }
  function ask(cands: Candidate[], to: MoveTo) {
    const ids = cands.map((c) => c.id);
    if (cands.some((c) => moveNeedsNote(c.status, to))) setMoving({ ids, to, names: cands.map((c) => c.name).join(", ") });
    else doMove(ids, to, "");
  }

  // ── schedule ──
  const [scheduleFor, setScheduleFor] = useState<Candidate | null>(null);

  // ── selection (send for approval) ──
  const [selFor, setSelFor] = useState<Candidate | null>(null);
  const [sel, setSel] = useState<SelectionDraft>({ designation_id: "", salary: "", basis: "monthly", joining_date: "", note: "" });
  function openSelection(c: Candidate) {
    const job = jobs.find((j) => j.id === c.job_id);
    setSel({
      designation_id: c.offer_designation_id ?? job?.designation_id ?? "",
      salary: s(c.offer_salary ?? c.expected_salary ?? job?.salary_max ?? null),
      basis: c.offer_basis ?? job?.salary_basis ?? "monthly",
      joining_date: c.offer_joining_date ?? "",
      note: "",
    });
    setSelFor(c);
  }
  const selDesignations = selFor
    ? designations.filter((o) => (designationFits(o, selFor.hires_as) && !o.inactive) || o.id === sel.designation_id)
    : [];
  function doSelection() {
    if (!selFor) return;
    const id = selFor.id;
    startTransition(async () => {
      const r = await submitSelection(id, sel);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success("Sent for approval");
      setSelFor(null);
      if (live?.id === id) refreshDetail(id);
      router.refresh();
    });
  }
  const [recallFor, setRecallFor] = useState<Candidate | null>(null);
  function doRecall(reason: string) {
    if (!recallFor) return;
    const id = recallFor.id;
    startTransition(async () => {
      const r = await recallSelection(id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Taken back from the approver");
        setRecallFor(null);
        if (live?.id === id) refreshDetail(id);
        router.refresh();
      }
    });
  }

  // ── joined ──
  const [joinFor, setJoinFor] = useState<Candidate | null>(null);
  const [join, setJoin] = useState({ person: "", joined_on: "", template_id: "" });
  function openJoin(c: Candidate) {
    const kind = c.hires_as === "staff" ? "staff" : "worker";
    const tpl = templates.find((t) => t.is_active && appliesToPerson(t.applies_to, kind));
    setJoin({ person: "", joined_on: c.approved_joining_date ?? t0, template_id: tpl?.id ?? "" });
    setJoinFor(c);
  }
  const joinPeople = joinFor ? people.filter((p) => p.kind === (joinFor.hires_as === "staff" ? "staff" : "worker")) : [];
  const joinTemplates = joinFor
    ? templates.filter((t) => t.is_active && appliesToPerson(t.applies_to, joinFor.hires_as === "staff" ? "staff" : "worker"))
    : [];
  function doJoin() {
    if (!joinFor) return;
    const id = joinFor.id;
    startTransition(async () => {
      const r = await markJoined(id, join.person, join.joined_on, join.template_id);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(join.template_id ? "Joined — joining checklist started" : "Joined");
      setJoinFor(null);
      setViewFor(null);
      router.refresh();
    });
  }

  // ?schedule=<id> / ?select=<id> hand-overs from other screens.
  const handOver = params.get("schedule") ?? params.get("select");
  useEffect(() => {
    if (!handOver) return;
    const c = rows.find((x) => x.id === handOver);
    const isSchedule = !!params.get("schedule");
    const timer = window.setTimeout(() => {
      if (c) {
        if (isSchedule) setScheduleFor(c);
        else openSelection(c);
      }
      router.replace(pathname, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per hand-over
  }, [handOver]);

  const hasScheduled = (c: Candidate) => !!c.next_interview_at;

  // ── table ──
  const columns: Column<Candidate>[] = [
    { header: "Code", cell: (c) => <span className="font-mono text-xs font-medium">{c.code ?? "—"}</span> },
    {
      header: "Candidate",
      cell: (c) => (
        <span className="text-sm">
          <span className="font-medium">{c.name}</span>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground">{c.phone}</span>
        </span>
      ),
    },
    { header: "Job", cell: (c) => <Truncated text={c.job_title} className="max-w-48 text-sm" /> },
    { header: "Source", cell: (c) => <span className="text-sm">{SOURCE_LABELS[c.source]}</span> },
    {
      header: "Exp.",
      align: "right",
      cell: (c) => <span className="text-sm tabular-nums">{c.experience_years != null ? `${c.experience_years} yr` : "—"}</span>,
    },
    {
      header: "Interviews",
      cell: (c) =>
        c.next_interview_at ? (
          <span className="text-sm tabular-nums">Next {fmtDateTime(c.next_interview_at)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">{c.rounds_done ? `${c.rounds_done} done` : "—"}</span>
        ),
    },
    { header: "Marks", align: "right", cell: (c) => <ScoreBadge score={c.avg_score} /> },
  ];
  const statusColumn: Column<Candidate> = {
    header: "Status",
    cell: (c) => <StatusPill tone={recruitmentTone(c.status)}>{recruitmentLabel(c.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Candidate>((c) => {
    const closed = c.status === "joined" || c.status === "withdrawn";
    return (
      <RowActions
        label={c.name}
        onView={() => openView(c)}
        onEdit={() => openEdit(c)}
        canEdit={canEdit}
        editDisabledReason={closed ? `${recruitmentLabel(c.status)} — not edited` : null}
        onDelete={() =>
          startTransition(async () => {
            const r = await deleteCandidate(c.id);
            if (!r.ok) toastError(r.error);
            else {
              success("Deleted");
              router.refresh();
            }
          })
        }
        canDelete={canDelete}
        deleteDisabledReason={c.status !== "new" || c.rounds_done || c.next_interview_at ? "Only a new candidate with no interviews — reject instead" : null}
        isPending={isPending}
        menu={[
          ...(c.resume_path ? [{ label: "Résumé", icon: FileText, onClick: () => openResume(c.resume_path!) }] : []),
          ...(canEdit && c.status === "new" ? [{ label: "Shortlist", icon: UserCheck, onClick: () => ask([c], "shortlisted") }] : []),
          ...(canEdit && ["new", "shortlisted", "interview"].includes(c.status) && !hasScheduled(c)
            ? [{ label: "Schedule interview", icon: CalendarPlus, onClick: () => setScheduleFor(c) }]
            : []),
          ...(canEdit && (c.status === "shortlisted" || c.status === "interview") && !hasScheduled(c)
            ? [{ label: "Select — send for approval", icon: BadgeCheck, onClick: () => openSelection(c) }]
            : []),
          ...(canEdit && c.status === "approved" ? [{ label: "Offer given", icon: Send, onClick: () => ask([c], "offered") }] : []),
          ...(canEdit && (c.status === "approved" || c.status === "offered")
            ? [{ label: "Mark joined", icon: UserRoundCheck, onClick: () => openJoin(c) }]
            : []),
        ]}
      />
    );
  });

  const bulkShortlist = chosen.length > 0 && chosen.every((c) => canMove(c.status, "shortlisted") && c.status !== "rejected");
  const bulkReject = chosen.length > 0 && chosen.every((c) => canMove(c.status, "rejected"));
  const job = jobs.find((j) => j.id === d.job_id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            label="Show"
            value={scope}
            onChange={(v) => {
              setScope(v);
              setSelected(new Set());
            }}
            options={[
              { value: "live", label: `In progress (${count("live")})` },
              { value: "new", label: `New & shortlisted (${count("new")})` },
              { value: "interview", label: `Interview (${count("interview")})` },
              { value: "selected", label: `Selected (${count("selected")})` },
              { value: "joined", label: `Joined (${count("joined")})` },
              { value: "closed", label: `Closed (${count("closed")})` },
              { value: "all", label: "All" },
            ]}
          />
          <div className="w-64">
            <Select aria-label="Job" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
              <option value="">All jobs</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} · {j.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {canCreate && <Button onClick={() => openEdit()}>+ Add Candidate</Button>}
      </div>

      <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
        {bulkShortlist && (
          <Button size="sm" disabled={isPending} onClick={() => ask(chosen, "shortlisted")}>
            Shortlist {chosen.length}
          </Button>
        )}
        {bulkReject && (
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => ask(chosen, "rejected")}>
            Reject {chosen.length}
          </Button>
        )}
      </SelectionBar>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(c) => c.id}
        selectable={canEdit && visible.length > 0}
        selectedKeys={selected}
        onToggle={(k) =>
          setSelected((x) => {
            const n = new Set(x);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            return n;
          })
        }
        onToggleAll={() => setSelected((x) => (x.size === visible.length ? new Set() : new Set(visible.map((c) => c.id))))}
        empty={openJobs.length === 0 ? "No candidates. Open a job on Job Openings first, then add candidates here." : "No candidates here."}
      />

      {/* ── Add / edit ───────────────────────────────────────────────────── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.name}` : "New candidate"}
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
        {/* 288 name + 176 phone + 176 email + gaps ≈ 680px → cap 48rem */}
        <div className="max-w-[48rem] space-y-5">
          <Field label="Job" required>
            <Select value={d.job_id} disabled={!!editId} onChange={(e) => put({ job_id: e.target.value })}>
              <option value="" />
              {(editId ? jobs : openJobs).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} · {j.title}
                </option>
              ))}
            </Select>
          </Field>
          <FieldRow>
            <Field label="Name" w="name" required>
              <Input value={d.name} onChange={(e) => put({ name: e.target.value })} />
            </Field>
            <Field label="Phone" w="code" required>
              <Input type="tel" inputMode="numeric" value={d.phone} onChange={(e) => put({ phone: e.target.value })} />
            </Field>
            <Field label="Email" w="term">
              <Input type="email" value={d.email} onChange={(e) => put({ email: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Gender" w="code">
              <Select value={d.gender} onChange={(e) => put({ gender: e.target.value })}>
                <option value="" />
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Date of birth" w="code">
              <Input type="date" value={d.date_of_birth} onChange={(e) => put({ date_of_birth: e.target.value })} />
            </Field>
            <Field label="Town / village" w="term">
              <Input value={d.town} onChange={(e) => put({ town: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Qualification" w="term">
              <Input value={d.qualification} onChange={(e) => put({ qualification: e.target.value })} />
            </Field>
            <Field label="Experience (yrs)" w="num">
              <Input type="number" min="0" step="0.5" value={d.experience_years} onChange={(e) => put({ experience_years: e.target.value })} />
            </Field>
            <Field label="Last / current employer" w="term">
              <Input value={d.current_employer} onChange={(e) => put({ current_employer: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label={`Current pay (₹${job ? basisWord(job.salary_basis) : ""})`} w="num">
              <Input type="number" min="0" value={d.current_salary} onChange={(e) => put({ current_salary: e.target.value })} />
            </Field>
            <Field label={`Expected (₹${job ? basisWord(job.salary_basis) : ""})`} w="num">
              <Input type="number" min="0" value={d.expected_salary} onChange={(e) => put({ expected_salary: e.target.value })} />
            </Field>
            <Field label="Can join in (days)" w="num">
              <Input type="number" min="0" value={d.notice_days} onChange={(e) => put({ notice_days: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Came through" w="term">
              <Select value={d.source} onChange={(e) => put({ source: e.target.value as Source })}>
                {SOURCES.map((x) => (
                  <option key={x} value={x}>
                    {SOURCE_LABELS[x]}
                  </option>
                ))}
              </Select>
            </Field>
            {d.source === "referral" ? (
              <Field label="Referred by" w="name" required>
                <PersonCombobox people={staff} value={d.referred_by_staff_id ? `staff:${d.referred_by_staff_id}` : ""} onChange={(k) => put({ referred_by_staff_id: k.split(":")[1] ?? "" })} />
              </Field>
            ) : (
              <Field label="Detail" w="name" hint="Agency, portal or paper name">
                <Input value={d.source_note} onChange={(e) => put({ source_note: e.target.value })} />
              </Field>
            )}
          </FieldRow>
          <Field label="Notes">
            <Textarea rows={2} value={d.notes} onChange={(e) => put({ notes: e.target.value })} />
          </Field>
          <Field label={editId ? "Replace résumé" : "Résumé"} hint="PDF, Word, JPEG or PNG — up to 5 MB">
            {/* autofill: exempt -- a file input has no suggestion list */}
            <input
              key={fileKey}
              type="file"
              accept={RESUME_ACCEPT}
              className="block w-full text-sm file:mr-3 file:rounded-control file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setDirty(true);
              }}
            />
          </Field>
        </div>
      </Sheet>

      {/* ── View ─────────────────────────────────────────────────────────── */}
      <Sheet
        open={!!live}
        onClose={() => setViewFor(null)}
        title={live ? `${live.code ?? "Candidate"} — ${live.name}` : "Candidate"}
        size="md"
        footer={live && canEdit ? viewFooter(live) : undefined}
      >
        {live && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={recruitmentTone(live.status)}>{recruitmentLabel(live.status)}</StatusPill>
              <span className="text-muted-foreground">
                {live.job_code} · {live.job_title}
              </span>
              {live.resume_path && (
                <Button size="sm" variant="outline" onClick={() => openResume(live.resume_path!)}>
                  Open résumé
                </Button>
              )}
            </div>
            <dl className="space-y-1">
              <Fact label="Phone" className="tabular-nums">
                {live.phone}
                {live.email ? ` · ${live.email}` : ""}
              </Fact>
              {(live.gender || live.date_of_birth || live.town) && (
                <Fact label="About">
                  {[
                    live.gender && live.gender.charAt(0).toUpperCase() + live.gender.slice(1),
                    live.date_of_birth && `born ${fmtDate(live.date_of_birth)}`,
                    live.town,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Fact>
              )}
              {(live.qualification || live.experience_years != null) && (
                <Fact label="Background">
                  {[live.qualification, live.experience_years != null && `${live.experience_years} yr experience`, live.current_employer]
                    .filter(Boolean)
                    .join(" · ")}
                </Fact>
              )}
              {(live.current_salary != null || live.expected_salary != null) && (
                <Fact label="Pay" className="tabular-nums">
                  {[
                    live.current_salary != null && `now ${fmtMoney(live.current_salary)}`,
                    live.expected_salary != null && `expects ${fmtMoney(live.expected_salary)}`,
                    live.notice_days != null && `can join in ${live.notice_days} day(s)`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Fact>
              )}
              <Fact label="Came through">
                {SOURCE_LABELS[live.source]}
                {live.referred_by_name ? ` — ${live.referred_by_name}` : live.source_note ? ` — ${live.source_note}` : ""}
              </Fact>
              {live.notes && (
                <Fact label="Notes" className="whitespace-pre-wrap">
                  {live.notes}
                </Fact>
              )}
              {live.closed_reason && <Fact label="Closed">{live.closed_reason}</Fact>}
            </dl>

            {(live.offer_salary != null || live.approved_salary != null) && (
              <section className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Offer</h3>
                <dl className="space-y-1">
                  {live.approved_salary != null && (
                    <Fact label="Approved" className="tabular-nums">
                      {fmtMoney(live.approved_salary)}
                      {basisWord(live.approved_basis)}
                      {live.approved_designation ? ` · ${live.approved_designation}` : ""}
                      {live.approved_joining_date ? ` · joins ${fmtDate(live.approved_joining_date)}` : ""}
                    </Fact>
                  )}
                  {live.offer_salary != null &&
                    (live.status === "pending_approval" || live.offer_salary !== live.approved_salary) && (
                      <Fact label={live.status === "pending_approval" ? "Proposed" : "Last proposed"} className="tabular-nums">
                        {fmtMoney(live.offer_salary)}
                        {basisWord(live.offer_basis)}
                        {live.offer_designation ? ` · ${live.offer_designation}` : ""}
                        {live.offer_joining_date ? ` · joins ${fmtDate(live.offer_joining_date)}` : ""}
                      </Fact>
                    )}
                  {live.decision_remark && <Fact label="Approver said">{live.decision_remark}</Fact>}
                  {live.offered_at && <Fact label="Offer given">{fmtDateTime(live.offered_at)}</Fact>}
                  {live.status === "joined" && (
                    <Fact label="Joined">
                      {live.joined_on ? fmtDate(live.joined_on) : ""}
                      {live.hired_name ? ` as ${live.hired_name}${live.hired_code ? ` (${live.hired_code})` : ""}` : ""}
                    </Fact>
                  )}
                </dl>
              </section>
            )}

            {panel?.id === live.id && panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={panel.timeline} resolveUserName={(id) => panel.names[id]} />
                {panel.verdict && live.status === "pending_approval" && (
                  <ApprovalActionBar
                    run={panel.run}
                    verdict={panel.verdict}
                    subjectPath="/hr/recruitment/candidates"
                    onDone={() => setViewFor(null)}
                  />
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interviews</h3>
              {!liveDetail ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : liveDetail.interviews.length === 0 ? (
                <p className="text-muted-foreground">None yet.</p>
              ) : (
                <ul className="space-y-2">
                  {liveDetail.interviews
                    .filter((i) => i.status !== "rescheduled")
                    .map((i) => (
                      <li key={i.id} className="rounded-control border border-border px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            Round {i.round_no} · {i.round_name}
                          </span>
                          <StatusPill tone={recruitmentTone(i.status)}>{recruitmentLabel(i.status)}</StatusPill>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {fmtDateTime(i.scheduled_at)} · {MODE_LABELS[i.mode]}
                          {i.venue ? ` · ${i.venue}` : ""} · {i.panel_names.join(", ")}
                        </p>
                        {i.scorecards.map((sc) => (
                          <p key={sc.id} className="text-xs">
                            <span className="font-medium">{sc.interviewer_name}</span>: {scoreOf(sc).toFixed(1)} / 5 ·{" "}
                            {RECOMMENDATION_LABELS[sc.recommendation]}
                            {sc.comments ? ` — ${sc.comments}` : ""}
                          </p>
                        ))}
                        {i.outcome_note && <p className="text-xs text-muted-foreground">{i.outcome_note}</p>}
                      </li>
                    ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
              {liveDetail && (
                <ol className="space-y-1.5">
                  {liveDetail.events.map((e) => (
                    <li key={e.id} className="text-xs">
                      <span className="tabular-nums text-muted-foreground">{fmtDateTime(e.created_at)}</span>{" "}
                      <span className="font-medium">{eventWords(e)}</span>
                      {e.note ? ` — ${e.note}` : ""}
                      {e.actor_name ? <span className="text-muted-foreground"> · {e.actor_name}</span> : null}
                    </li>
                  ))}
                </ol>
              )}
              {canEdit && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label="Add a note">
                      <Input value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                  </div>
                  <Button variant="outline" disabled={isPending || !note.trim()} onClick={saveNote}>
                    Add
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}
      </Sheet>

      <ScheduleSheet
        open={!!scheduleFor}
        onClose={() => setScheduleFor(null)}
        candidate={scheduleFor}
        nextRound={(scheduleFor?.rounds_done ?? 0) + 1}
        reschedule={null}
        staff={staff}
      />

      {/* ── Selection ────────────────────────────────────────────────────── */}
      <Sheet
        open={!!selFor}
        onClose={() => setSelFor(null)}
        title={
          selFor && REVISING.includes(selFor.status)
            ? `Revise the offer — ${selFor.name}`
            : `Select ${selFor?.name ?? ""}`
        }
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSelFor(null)}>
              Cancel
            </Button>
            <Button disabled={isPending || !(Number(sel.salary) > 0) || !sel.joining_date} onClick={doSelection}>
              {isPending ? "Sending…" : "Send for approval"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The approver (Admin ▸ Approval Flows ▸ Hiring) sees this offer.
            {selFor?.expected_salary != null ? ` They expect ${fmtMoney(selFor.expected_salary)}.` : ""}
          </p>
          <Field label="Designation">
            <Select value={sel.designation_id} onChange={(e) => setSel((x) => ({ ...x, designation_id: e.target.value }))}>
              <option value="" />
              {selDesignations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <FieldRow>
            <Field label="Salary (₹)" w="num" required>
              <Input type="number" min="1" value={sel.salary} onChange={(e) => setSel((x) => ({ ...x, salary: e.target.value }))} />
            </Field>
            <Field label="Per">
              <Segmented
                name="sel-basis"
                value={sel.basis}
                onChange={(v) => setSel((x) => ({ ...x, basis: v }))}
                options={[
                  { value: "monthly", label: "Month" },
                  { value: "daily", label: "Day" },
                ]}
              />
            </Field>
          </FieldRow>
          <Field label="Joining date" w="code" required>
            <Input type="date" min={t0} value={sel.joining_date} onChange={(e) => setSel((x) => ({ ...x, joining_date: e.target.value }))} />
          </Field>
          <Field label="Note for the approver">
            <Textarea rows={2} value={sel.note} onChange={(e) => setSel((x) => ({ ...x, note: e.target.value }))} />
          </Field>
        </div>
      </Sheet>

      {/* ── Joined ───────────────────────────────────────────────────────── */}
      <Sheet
        open={!!joinFor}
        onClose={() => setJoinFor(null)}
        title={`${joinFor?.name ?? ""} has joined`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setJoinFor(null)}>
              Cancel
            </Button>
            <Button disabled={isPending || !join.person} onClick={doJoin}>
              {isPending ? "Saving…" : "Mark joined"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            {joinFor?.hires_as === "staff"
              ? "Add them on People ▸ Staff first, then pick that record here."
              : "Add them on People ▸ Workers first, then pick that record here."}
          </p>
          <Field label={joinFor?.hires_as === "staff" ? "Staff record" : "Worker record"} required>
            <PersonCombobox people={joinPeople} value={join.person} onChange={(v) => setJoin((x) => ({ ...x, person: v }))} />
          </Field>
          <Field label="Joined on" w="code">
            <Input type="date" value={join.joined_on} onChange={(e) => setJoin((x) => ({ ...x, joined_on: e.target.value }))} />
          </Field>
          <Field label="Start a joining checklist" hint="Optional — Team Lifecycle ▸ Joining Checklists">
            <Select value={join.template_id} onChange={(e) => setJoin((x) => ({ ...x, template_id: e.target.value }))}>
              <option value="">Don&apos;t start one</option>
              {joinTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Sheet>

      <ReasonSheet
        open={!!moving}
        busy={isPending}
        onClose={() => setMoving(null)}
        onConfirm={(reason) => moving && doMove(moving.ids, moving.to, reason)}
        title={moving ? `${MOVE_WORDS[moving.to].title} — ${moving.ids.length > 1 ? `${moving.ids.length} candidates` : moving.names}` : ""}
        confirmLabel={moving ? MOVE_WORDS[moving.to].button : ""}
        danger={moving?.to === "rejected"}
        intro={moving ? MOVE_WORDS[moving.to].intro : ""}
      />

      <ReasonSheet
        open={!!recallFor}
        busy={isPending}
        onClose={() => setRecallFor(null)}
        onConfirm={doRecall}
        title={`Take back ${recallFor?.name ?? ""}`}
        confirmLabel="Take back"
        intro="Takes the selection out of the approver's queue; the candidate goes back to where they were."
      />
    </div>
  );

  function viewFooter(c: Candidate): ReactNode {
    const btn = (label: string, onClick: () => void, variant: "primary" | "outline" = "outline") => (
      <Button key={label} variant={variant} disabled={isPending} onClick={onClick}>
        {label}
      </Button>
    );
    const left: ReactNode[] = [];
    const right: ReactNode[] = [];
    if (canMove(c.status, "rejected")) left.push(btn("Reject", () => ask([c], "rejected")));
    if (canMove(c.status, "withdrawn")) left.push(btn("Withdrawn", () => ask([c], "withdrawn")));
    if (c.status === "rejected") left.push(btn("Reconsider", () => ask([c], "shortlisted")));
    if (canMove(c.status, "offer_declined")) left.push(btn("Declined", () => ask([c], "offer_declined")));
    if (canMove(c.status, "no_show")) left.push(btn("Did not join", () => ask([c], "no_show")));
    if (c.status === "pending_approval") left.push(btn("Take back", () => setRecallFor(c)));

    if (c.status === "new") right.push(btn("Shortlist", () => ask([c], "shortlisted")));
    if (["new", "shortlisted", "interview"].includes(c.status) && !hasScheduled(c))
      right.push(btn("Schedule interview", () => setScheduleFor(c)));
    if ((c.status === "shortlisted" || c.status === "interview") && !hasScheduled(c))
      right.push(btn("Select", () => openSelection(c), "primary"));
    if (c.status === "approved" || c.status === "offered" || c.status === "offer_declined")
      right.push(btn("Revise offer", () => openSelection(c)));
    if (c.status === "approved") right.push(btn("Offer given", () => ask([c], "offered")));
    if (c.status === "approved" || c.status === "offered") right.push(btn("Mark joined", () => openJoin(c), "primary"));
    if (left.length + right.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">{left}</div>
        <div className="flex flex-wrap gap-2">{right}</div>
      </div>
    );
  }
}

function eventWords(e: CandidateEvent): string {
  const d = (e.data ?? {}) as Record<string, string | number | boolean | null>;
  switch (e.kind) {
    case "created":
      return "Added";
    case "edited":
      return "Details edited";
    case "note":
      return "Note";
    case "moved":
      return `${recruitmentLabel(e.from_status ?? "")} → ${recruitmentLabel(e.to_status ?? "")}`;
    case "interview":
      if (d.outcome) return `Round ${d.round} ${d.round_name ?? ""} ${String(d.outcome).replace("_", " ")}`;
      if (d.rescheduled_to) return `Round ${d.round} moved to ${fmtDateTime(String(d.rescheduled_to))}`;
      return `Round ${d.round} ${d.round_name ?? ""} scheduled for ${d.at ? fmtDateTime(String(d.at)) : ""}`;
    case "offer":
      return `Sent for approval — ${fmtMoney(Number(d.salary))}${d.basis === "daily" ? " / day" : " / month"}${
        d.designation ? `, ${d.designation}` : ""
      }${d.joining_date ? `, joining ${fmtDate(String(d.joining_date))}` : ""}`;
    case "decision":
      return `Approval: ${recruitmentLabel(e.to_status ?? "")}`;
    case "joined":
      return `Joined as ${d.person ?? ""}${d.code ? ` (${d.code})` : ""}`;
    default:
      return e.kind;
  }
}
