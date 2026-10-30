"use client";

import { CircleCheck, CirclePlay, CircleStop, FileText, Upload, Users } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { SelectionBar } from "@/components/ui/selection-bar";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import {
  attachCertificate,
  certificateLink,
  deleteTraining,
  enrolPeople,
  loadEnrolments,
  removeEnrolment,
  saveTraining,
  setEnrolmentStatus,
  setTrainingStatus,
} from "@/lib/hr/performance-actions";
import {
  CATEGORY_LABELS,
  CERT_ACCEPT,
  CERT_BUCKET,
  CERT_MAX_BYTES,
  TRAINING_CATEGORIES,
  performanceLabel,
  performanceTone,
  type Enrolment,
  type EnrolmentStatus,
  type Training,
  type TrainingCategory,
  type TrainingStatus,
} from "@/lib/hr/performance-types";
import { personKey, type PersonOption } from "@/lib/hr/timeoff-types";
import { Fact, ReasonSheet } from "@/components/hr/timeoff/shared";
import { PersonCombobox } from "@/components/hr/lifecycle/shared";

/**
 * HR ▸ Performance & Growth ▸ Training (0773, MyJKKN §13.3).
 *
 * A session runs Draft → Open → In progress → Completed (or Cancelled). HR
 * puts people on it within its seats, marks who attended and who completed,
 * and keeps each certificate. MyJKKN had no seat limit, kept the certificate
 * as a typed link, and let a person set their own enrolment to completed;
 * here the seats hold, certificates are files in a private bucket, and only HR
 * moves an enrolment.
 */

type Props = {
  rows: Training[];
  enrolments: Enrolment[];
  people: PersonOption[];
  myStaffId: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Draft = {
  title: string;
  category: TrainingCategory;
  trainer: string;
  venue: string;
  starts_on: string;
  ends_on: string;
  hours: string;
  seats: string;
  description: string;
  status: "draft" | "open";
};
const BLANK = (): Draft => ({
  title: "",
  category: "skill",
  trainer: "",
  venue: "",
  starts_on: today(),
  ends_on: today(),
  hours: "",
  seats: "",
  description: "",
  status: "open",
});
const s = (n: number | null) => (n == null ? "" : String(n));

const STATUS_MOVE: Partial<Record<TrainingStatus, { label: string; done: string; icon: typeof CirclePlay }>> = {
  open: { label: "Open", done: "Training opened", icon: CirclePlay },
  in_progress: { label: "Start", done: "Training started", icon: CirclePlay },
  completed: { label: "Complete", done: "Training completed", icon: CircleCheck },
};

function datesOf(t: { starts_on: string; ends_on: string }): string {
  return t.starts_on === t.ends_on ? fmtDate(t.starts_on) : `${fmtDate(t.starts_on)} – ${fmtDate(t.ends_on)}`;
}

export function TrainingScreen({ rows, enrolments, people, myStaffId, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isSelf = !!myStaffId && !canEdit;

  const [view, setView] = useState<"sessions" | "person">(isSelf ? "person" : "sessions");
  const [scope, setScope] = useState<"live" | "done" | "all">("live");
  const visible = useMemo(
    () =>
      scope === "live"
        ? rows.filter((t) => t.status === "draft" || t.status === "open" || t.status === "in_progress")
        : scope === "done"
          ? rows.filter((t) => t.status === "completed" || t.status === "cancelled")
          : rows,
    [rows, scope],
  );

  // ── add / edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(BLANK);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openEdit(t?: Training) {
    setEditId(t?.id ?? null);
    setD(
      t
        ? {
            title: t.title,
            category: t.category,
            trainer: t.trainer ?? "",
            venue: t.venue ?? "",
            starts_on: t.starts_on,
            ends_on: t.ends_on,
            hours: s(t.hours),
            seats: s(t.seats),
            description: t.description ?? "",
            status: "open",
          }
        : BLANK(),
    );
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openEdit());
  const problem = !d.title.trim()
    ? "Name the training"
    : !d.starts_on || !d.ends_on
      ? "Enter the dates"
      : d.ends_on < d.starts_on
        ? "It ends before it starts"
        : null;
  function save() {
    startTransition(async () => {
      const r = await saveTraining(editId, {
        ...d,
        hours: d.hours || null,
        seats: d.seats || null,
        status: editId ? undefined : d.status,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? "Training saved" : "Training added");
      router.refresh();
    });
  }

  const [cancelFor, setCancelFor] = useState<Training | null>(null);
  function move(t: Training, to: TrainingStatus, reason = "") {
    startTransition(async () => {
      const r = await setTrainingStatus(t.id, to, reason);
      if (!r.ok) toastError(r.error);
      else {
        success(to === "cancelled" ? "Training cancelled" : (STATUS_MOVE[to]?.done ?? "Saved"));
        setCancelFor(null);
        router.refresh();
      }
    });
  }

  // ── the people on one training ──
  const [peopleFor, setPeopleFor] = useState<Training | null>(null);
  const liveT = peopleFor ? (rows.find((t) => t.id === peopleFor.id) ?? peopleFor) : null;
  const [list, setList] = useState<{ id: string; rows: Enrolment[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addKeys, setAddKeys] = useState<string[]>([]);
  function refreshList(id: string) {
    loadEnrolments(id).then((x) => setList({ id, rows: x }));
  }
  function openPeople(t: Training) {
    setPeopleFor(t);
    setList(null);
    setPicked(new Set());
    setAddKeys([]);
    refreshList(t.id);
  }
  const listRows = liveT && list?.id === liveT.id ? list.rows : null;
  const onIt = new Set((listRows ?? []).map((e) => (e.staff_id ? personKey("staff", e.staff_id) : personKey("worker", e.worker_id as string))));
  const addable = people.filter((p) => !onIt.has(p.key));
  const editableT = !!liveT && canEdit && liveT.status !== "cancelled";
  const joinable = !!liveT && canEdit && ["draft", "open", "in_progress"].includes(liveT.status);
  const started = !!liveT && (liveT.status === "in_progress" || liveT.status === "completed");

  function doEnrol() {
    if (!liveT) return;
    const id = liveT.id;
    startTransition(async () => {
      const r = await enrolPeople(id, addKeys);
      if (!r.ok) toastError(r.error);
      else success(`${r.count ?? 0} added`);
      setAddKeys([]);
      refreshList(id);
      router.refresh();
    });
  }
  const [dropping, setDropping] = useState<string[] | null>(null);
  function doStatus(ids: string[], to: EnrolmentStatus, remark = "") {
    if (!liveT) return;
    const id = liveT.id;
    startTransition(async () => {
      const r = await setEnrolmentStatus(ids, to, remark);
      if (!r.ok) toastError(r.error);
      else {
        success(`${r.count ?? ids.length} marked ${performanceLabel(to).toLowerCase()}`);
        setPicked(new Set());
        setDropping(null);
      }
      refreshList(id);
      router.refresh();
    });
  }
  function doRemove(e: Enrolment) {
    if (!liveT) return;
    const id = liveT.id;
    startTransition(async () => {
      const r = await removeEnrolment(e.id);
      if (!r.ok) toastError(r.error);
      else success("Removed");
      refreshList(id);
      router.refresh();
    });
  }

  // ── certificates ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [certFor, setCertFor] = useState<Enrolment | null>(null);
  function pickCert(e: Enrolment) {
    setCertFor(e);
    fileRef.current?.click();
  }
  function uploadCert(file: File | undefined) {
    const e = certFor;
    if (!file || !e || !liveT) return;
    if (!CERT_ACCEPT.split(",").includes(file.type)) {
      toastError("The certificate must be a PDF, JPEG or PNG");
      return;
    }
    if (file.size > CERT_MAX_BYTES) {
      toastError("The certificate is over 5 MB");
      return;
    }
    const t = liveT;
    startTransition(async () => {
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      const path = `${t.location_id}/${t.id}/${crypto.randomUUID()}.${ext}`;
      const up = await createClient().storage.from(CERT_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
      if (up.error) {
        toastError(`Upload failed — ${up.error.message}`);
        return;
      }
      const r = await attachCertificate(e.id, path, file.name);
      if (!r.ok) toastError(r.error);
      else success("Certificate attached");
      setCertFor(null);
      refreshList(t.id);
    });
  }
  function openCert(path: string) {
    startTransition(async () => {
      const r = await certificateLink(path);
      if (r.ok) window.open(r.url, "_blank", "noopener");
      else toastError(r.error);
    });
  }

  // ── by person ──
  const [personKeyV, setPersonKeyV] = useState("");
  const personRows = isSelf
    ? enrolments
    : personKeyV
      ? enrolments.filter((e) => (e.staff_id ? personKey("staff", e.staff_id) : personKey("worker", e.worker_id as string)) === personKeyV)
      : [];

  // ── tables ──
  const columns: Column<Training>[] = [
    { header: "Code", cell: (t) => <span className="font-mono text-xs font-medium">{t.code ?? "—"}</span> },
    {
      header: "Training",
      cell: (t) => (
        <span className="text-sm">
          <span className="font-medium">{t.title}</span>
          <span className="ml-2 text-xs text-muted-foreground">{CATEGORY_LABELS[t.category]}</span>
        </span>
      ),
    },
    { header: "Dates", cell: (t) => <span className="text-sm tabular-nums">{datesOf(t)}</span> },
    { header: "Trainer", cell: (t) => <span className="text-sm">{t.trainer ?? "—"}</span> },
    {
      header: "People",
      cell: (t) => (
        <span className="text-sm tabular-nums">
          {t.counts.taken}
          {t.seats != null ? ` / ${t.seats}` : ""}
          {t.counts.completed > 0 && <span className="ml-2 text-xs text-muted-foreground">· {t.counts.completed} completed</span>}
        </span>
      ),
    },
  ];
  const statusColumn: Column<Training> = {
    header: "Status",
    cell: (t) => <StatusPill tone={performanceTone(t.status)}>{performanceLabel(t.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Training>((t) => {
    const next = (["open", "in_progress", "completed"] as const).find((x) =>
      t.status === "draft" ? x === "open" : t.status === "open" ? x === "in_progress" : t.status === "in_progress" ? x === "completed" : false,
    );
    return (
      <RowActions
        label={t.title}
        view={false}
        onEdit={() => openEdit(t)}
        canEdit={canEdit}
        editDisabledReason={t.status === "completed" || t.status === "cancelled" ? `${performanceLabel(t.status)} — not edited` : null}
        onDelete={() =>
          startTransition(async () => {
            const r = await deleteTraining(t.id);
            if (!r.ok) toastError(r.error);
            else {
              success("Deleted");
              router.refresh();
            }
          })
        }
        canDelete={canDelete}
        deleteDisabledReason={t.status !== "draft" ? "Only a draft training can be deleted — cancel it instead" : null}
        isPending={isPending}
        menu={[
          { label: "People", icon: Users, onClick: () => openPeople(t) },
          ...(canEdit && next && STATUS_MOVE[next] ? [{ label: STATUS_MOVE[next]!.label, icon: STATUS_MOVE[next]!.icon, onClick: () => move(t, next) }] : []),
          ...(canEdit && (t.status === "draft" || t.status === "open" || t.status === "in_progress")
            ? [{ label: "Cancel…", icon: CircleStop, onClick: () => setCancelFor(t) }]
            : []),
        ]}
      />
    );
  });

  const enrolColumns: Column<Enrolment>[] = [
    {
      header: "Person",
      cell: (e) => (
        <span className="text-sm">
          <span className="font-medium">{e.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {e.person_code ?? ""}
            {e.person_kind === "worker" ? " · Worker" : ""}
          </span>
        </span>
      ),
    },
    {
      header: "Status",
      cell: (e) => (
        <span className="text-sm">
          <StatusPill tone={performanceTone(e.status)}>{performanceLabel(e.status)}</StatusPill>
          {e.remark && <span className="ml-2 text-xs text-muted-foreground">{e.remark}</span>}
        </span>
      ),
    },
    {
      header: "",
      cell: (e) => (
        <span className="flex items-center justify-end gap-1">
          {e.certificate_path && (
            <RowIconAction label="Open certificate" icon={FileText} onClick={() => openCert(e.certificate_path!)} />
          )}
          {editableT && e.status === "completed" && (
            <RowIconAction label={e.certificate_path ? "Replace certificate" : "Upload certificate"} icon={Upload} onClick={() => pickCert(e)} />
          )}
          {joinable && e.status === "registered" && liveT && (liveT.status === "draft" || liveT.status === "open") && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => doRemove(e)}>
              Remove
            </Button>
          )}
        </span>
      ),
    },
  ];

  const personColumns: Column<Enrolment>[] = [
    {
      header: "Training",
      cell: (e) => (
        <span className="text-sm">
          <span className="font-medium">{e.training_title}</span>
          <span className="ml-2 text-xs text-muted-foreground">{CATEGORY_LABELS[e.category]}</span>
        </span>
      ),
    },
    { header: "Dates", cell: (e) => <span className="text-sm tabular-nums">{datesOf(e)}</span> },
    { header: "Hours", align: "right", cell: (e) => <span className="text-sm tabular-nums">{e.hours ?? "—"}</span> },
    { header: "Completed", cell: (e) => <span className="text-sm tabular-nums">{e.completed_on ? fmtDate(e.completed_on) : "—"}</span> },
    {
      header: "Status",
      cell: (e) => <StatusPill tone={performanceTone(e.status)}>{performanceLabel(e.status)}</StatusPill>,
    },
    {
      header: "",
      cell: (e) =>
        e.certificate_path ? <RowIconAction label="Open certificate" icon={FileText} onClick={() => openCert(e.certificate_path!)} /> : null,
    },
  ];

  const chosen = (listRows ?? []).filter((e) => picked.has(e.id));
  const hours = personRows.filter((e) => e.status === "completed").reduce((a, e) => a + (e.hours ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {!isSelf && (
            <ToggleGroup
              label="View"
              role="tablist"
              value={view}
              onChange={setView}
              options={[
                { value: "sessions", label: "Sessions" },
                { value: "person", label: "By person" },
              ]}
            />
          )}
          {view === "sessions" && (
            <ToggleGroup
              label="Show"
              value={scope}
              onChange={setScope}
              options={[
                { value: "live", label: "Upcoming & running" },
                { value: "done", label: "Completed & cancelled" },
                { value: "all", label: "All" },
              ]}
            />
          )}
        </div>
        {view === "sessions" && canCreate && <Button onClick={() => openEdit()}>+ Add Training</Button>}
      </div>

      {view === "sessions" ? (
        <DataTable
          columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
          rows={visible}
          getKey={(t) => t.id}
          empty={scope === "live" ? "No upcoming training. Add a session to start." : "No training here."}
        />
      ) : (
        <div className="space-y-3">
          {!isSelf && (
            <div className="max-w-md">
              <Field label="Person">
                <PersonCombobox people={people} value={personKeyV} onChange={setPersonKeyV} />
              </Field>
            </div>
          )}
          {(isSelf || personKeyV) && (
            <p className="text-sm text-muted-foreground">
              {personRows.filter((e) => e.status === "completed").length} completed
              {hours > 0 ? ` · ${hours} hours` : ""}
            </p>
          )}
          <DataTable
            columns={personColumns}
            rows={personRows}
            getKey={(e) => e.id}
            empty={isSelf ? "You have not been on any training yet." : personKeyV ? "No training for this person yet." : "Pick a person to see their training."}
          />
        </div>
      )}

      {/* ── Add / edit ───────────────────────────────────────────────────── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.title}` : "New training"}
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
        {/* 288 title + 176 category + gap ≈ 480px; dates row 4 × 112 ≈ 470px → cap 40rem */}
        <div className="max-w-[40rem] space-y-5">
          <FieldRow>
            <Field label="Training" w="name" required>
              <Input value={d.title} onChange={(e) => put({ title: e.target.value })} />
            </Field>
            <Field label="Kind" w="term">
              <Select value={d.category} onChange={(e) => put({ category: e.target.value as TrainingCategory })}>
                {TRAINING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="From" w="code" required>
              <Input type="date" value={d.starts_on} onChange={(e) => put({ starts_on: e.target.value, ends_on: d.ends_on < e.target.value ? e.target.value : d.ends_on })} />
            </Field>
            <Field label="To" w="code" required>
              <Input type="date" value={d.ends_on} onChange={(e) => put({ ends_on: e.target.value })} />
            </Field>
            <Field label="Hours" w="num">
              <Input type="number" min="0" step="0.5" value={d.hours} onChange={(e) => put({ hours: e.target.value })} />
            </Field>
            <Field label="Seats" w="num" hint="Blank: no limit">
              <Input type="number" min="1" max="1000" value={d.seats} onChange={(e) => put({ seats: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Trainer" w="name">
              <Input value={d.trainer} onChange={(e) => put({ trainer: e.target.value })} />
            </Field>
            <Field label="Venue" w="term">
              <Input value={d.venue} onChange={(e) => put({ venue: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="About it">
            <Textarea rows={3} value={d.description} onChange={(e) => put({ description: e.target.value })} />
          </Field>
          {!editId && (
            <Field label="Start as">
              <Segmented
                name="training-status"
                value={d.status}
                onChange={(v) => put({ status: v })}
                options={[
                  { value: "open", label: "Open — add people now" },
                  { value: "draft", label: "Draft" },
                ]}
              />
            </Field>
          )}
        </div>
      </Sheet>

      {/* ── People on a training ─────────────────────────────────────────── */}
      <Sheet
        open={!!liveT}
        onClose={() => setPeopleFor(null)}
        title={liveT ? `${liveT.code ?? "Training"} — ${liveT.title}` : "Training"}
        size="md"
      >
        {liveT && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={performanceTone(liveT.status)}>{performanceLabel(liveT.status)}</StatusPill>
              <span className="text-muted-foreground">
                {CATEGORY_LABELS[liveT.category]} · {datesOf(liveT)}
                {liveT.hours ? ` · ${liveT.hours} h` : ""}
              </span>
            </div>
            <dl className="space-y-1">
              {liveT.trainer && <Fact label="Trainer">{liveT.trainer}</Fact>}
              {liveT.venue && <Fact label="Venue">{liveT.venue}</Fact>}
              <Fact label="Seats" className="tabular-nums">
                {liveT.counts.taken}
                {liveT.seats != null ? ` of ${liveT.seats} taken` : " — no limit"}
              </Fact>
              {liveT.cancel_reason && <Fact label="Cancelled">{liveT.cancel_reason}</Fact>}
            </dl>

            {joinable && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <MultiSelect
                    label="Add people"
                    options={addable.map((p) => ({ id: p.key, label: `${p.name}${p.code ? ` (${p.code})` : ""}${p.kind === "worker" ? " · Worker" : ""}` }))}
                    values={addKeys}
                    onChange={setAddKeys}
                    emptyLabel="Everyone is already on it"
                  />
                </div>
                <Button disabled={isPending || addKeys.length === 0} onClick={doEnrol}>
                  Add
                </Button>
              </div>
            )}

            {editableT && started && (
              <SelectionBar count={chosen.length} onClear={() => setPicked(new Set())}>
                <Button size="sm" disabled={isPending} onClick={() => doStatus(chosen.map((e) => e.id), "attended")}>
                  Attended
                </Button>
                <Button size="sm" disabled={isPending} onClick={() => doStatus(chosen.map((e) => e.id), "completed")}>
                  Completed
                </Button>
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => setDropping(chosen.map((e) => e.id))}>
                  Dropped
                </Button>
              </SelectionBar>
            )}

            {!listRows ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : (
              <DataTable
                columns={enrolColumns}
                rows={listRows}
                getKey={(e) => e.id}
                paginate={false}
                selectable={editableT && started && listRows.length > 0}
                selectedKeys={picked}
                onToggle={(k) =>
                  setPicked((x) => {
                    const n = new Set(x);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                onToggleAll={() => setPicked((x) => (x.size === listRows.length ? new Set() : new Set(listRows.map((e) => e.id))))}
                empty={joinable ? "Nobody on it yet. Add people above." : "Nobody was on this training."}
              />
            )}
            {editableT && !started && (listRows?.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">Start the training to mark who attended and completed.</p>
            )}
          </div>
        )}
      </Sheet>

      <input
        ref={fileRef}
        type="file"
        accept={CERT_ACCEPT}
        className="hidden"
        // autofill: exempt -- a file input has no suggestion list
        onChange={(e) => {
          uploadCert(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <ReasonSheet
        open={!!cancelFor}
        busy={isPending}
        onClose={() => setCancelFor(null)}
        onConfirm={(reason) => cancelFor && move(cancelFor, "cancelled", reason)}
        title={`Cancel ${cancelFor?.code ?? ""}`}
        confirmLabel="Cancel training"
        danger
        intro="Nobody can be added or marked on it afterwards. The people already on it stay listed."
      />
      <ReasonSheet
        open={!!dropping}
        busy={isPending}
        onClose={() => setDropping(null)}
        onConfirm={(reason) => dropping && doStatus(dropping, "dropped", reason)}
        title={`Mark ${dropping?.length ?? 0} dropped`}
        confirmLabel="Mark dropped"
        intro="Their seat is freed. Say why."
      />
    </div>
  );
}
