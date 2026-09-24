"use client";

/**
 * Orders ▸ CAD ▸ CAD Lifecycle — the four sheets (doc/order/cad.md §2–§4).
 *
 *   AllocationSheet  Allocate v1 · Re-allocate v(n+1) after a Rework · Edit a
 *                    version not yet dispatched
 *   DispatchSheet    record what went to the buyer, with the .DXF/.PDS/.PLT
 *   DecisionSheet    the buyer's answer — Approved or Rework Required
 *   HistorySheet     every version of the style, read-only
 *
 * MOUNT EACH ONLY WHILE OPEN (`{x && <Sheet … />}`), the ReopenBudgetSheet
 * rule: the answers are the sheet's own state, so each opening starts from the
 * record rather than from the last one typed.
 *
 * THE BUTTON EXPLAINS INSTEAD OF GOING DEAD. Save is always pressable; a press
 * with a rule unmet shows the rule's sentence (`allocationProblem` …, the same
 * words the database raises) above the footer instead of a greyed button that
 * says nothing about why.
 *
 * `size="sm"`: each is a short form over the listing (AGENTS.md "A sub-detail
 * Sheet's size" — a hand-laid form with no ChildGrid, so `md`'s width would
 * only be blank space). History is `md`: it lays versions side by side in a
 * table of facts.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { RecordPicker } from "@/components/masters/record-picker";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { today as istToday } from "@/lib/calendar";
import {
  allocateCad,
  decideCad,
  discardCadUploads,
  dispatchCad,
  updateCadAllocation,
} from "@/lib/orders/cad-lifecycle/actions";
import {
  allocationProblem,
  CAD_STATE_META,
  CAD_TYPES,
  cadStateOf,
  cadTypeLabel,
  decisionProblem,
  dispatchProblem,
  LAYOUT_TYPES,
  layoutLabel,
  latestVersion,
  patternMakerOptions,
  type CadFileInput,
  type CadStyleRow,
  type CadType,
  type CadVersion,
  type LayoutType,
  type PatternMakerRow,
} from "@/lib/orders/cad-lifecycle/types";
import { CadFileUpload, downloadCadFile, prettySize } from "./cad-file-upload";

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
      {text}
    </p>
  );
}

/** The order and style the sheet is about — read-only facts, never fields. */
function Subject({ row, extra }: { row: CadStyleRow; extra?: React.ReactNode }) {
  return (
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
      <dt className="text-muted-foreground">Order</dt>
      <dd className="font-medium">
        {row.re_no ?? row.order_code ?? "—"}
        {row.customer_name ? <span className="text-muted-foreground"> · {row.customer_name}</span> : null}
      </dd>
      <dt className="text-muted-foreground">Style</dt>
      <dd className="font-medium">
        {row.style_ref_no}
        {row.style_description ? <span className="text-muted-foreground"> · {row.style_description}</span> : null}
      </dd>
      <dt className="text-muted-foreground">Layout Type</dt>
      <dd>{row.layout_type ? layoutLabel(row.layout_type) : <span className="text-muted-foreground">Not declared on the order</span>}</dd>
      {extra}
    </dl>
  );
}

// ===========================================================================
// ALLOCATION
// ===========================================================================

export type AllocationMode = "new" | "reallocate" | "edit";

export function AllocationSheet({
  row,
  mode,
  employees,
  origin,
  onClose,
}: {
  row: CadStyleRow;
  mode: AllocationMode;
  employees: PatternMakerRow[];
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const latest = latestVersion(row.versions);
  // Edit works on the latest (undispatched) version; Re-allocate starts from it
  // — the same maker and type are the likeliest answers for the next attempt.
  const seed = mode === "new" ? null : latest;
  const today = istToday();
  const [makerId, setMakerId] = useState<string | null>(seed?.pattern_maker_id ?? null);
  const [cadType, setCadType] = useState<CadType | "">(seed?.cad_type ?? "");
  const [target, setTarget] = useState<string>(mode === "edit" ? (seed?.target_date ?? "") : "");
  const [remarks, setRemarks] = useState<string>(mode === "edit" ? (seed?.remarks ?? "") : "");
  const [problem, setProblem] = useState<string | null>(null);

  const makers = patternMakerOptions(employees, makerId);
  const nextVersion = mode === "edit" ? (latest?.version_no ?? 1) : (latest?.version_no ?? 0) + 1;
  const allocationDate = mode === "edit" ? (latest?.allocation_date ?? today) : today;
  const title =
    mode === "edit"
      ? `Edit CAD allocation — V${nextVersion}`
      : mode === "reallocate"
        ? `Re-allocate CAD — V${nextVersion}`
        : "Allocate CAD — V1";

  function save() {
    const why = allocationProblem(
      { pattern_maker_id: makerId, cad_type: cadType || null, target_date: target || null },
      allocationDate,
    );
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    const payload = {
      garment_order_id: row.garment_order_id,
      style_ref_no: row.style_ref_no,
      pattern_maker_id: makerId!,
      cad_type: cadType as CadType,
      target_date: target,
      remarks,
    };
    start(async () => {
      const r = mode === "edit" && latest ? await updateCadAllocation(latest.id, payload) : await allocateCad(payload);
      if (!r.ok) {
        setProblem(r.error);
        return;
      }
      toast.success(mode === "edit" ? "Allocation updated" : `CAD V${nextVersion} allocated`);
      onClose();
    });
  }

  const rework = mode === "reallocate" ? latest?.decision?.buyer_comments : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : mode === "edit" ? "Save" : "Allocate"}
          </Button>
        </>
      }
    >
      <Subject row={row} />
      {rework && (
        <p className="mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
          <span className="font-semibold">Buyer asked for (V{latest?.version_no}):</span> {rework}
        </p>
      )}
      <Field label="Pattern Maker" required hint={makers.hint ?? undefined}>
        <RecordPicker
          label="Pattern Maker"
          compact
          required
          items={makers.items}
          emptyHint={makers.hint}
          value={makerId}
          onChange={setMakerId}
        />
      </Field>
      <FieldRow className="mt-3">
        <Field label="CAD Type" required w="term" htmlFor="cad-type">
          <Select id="cad-type" value={cadType} onChange={(e) => setCadType(e.target.value as CadType | "")}>
            <option value="" />
            {CAD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>
      <FieldRow className="mt-3">
        <Field label="Allocation Date" w="code" htmlFor="cad-alloc-date" hint="System date">
          <Input id="cad-alloc-date" readOnly value={fmtDate(allocationDate)} />
        </Field>
        <Field label="Internal Target Date" required w="code" htmlFor="cad-target">
          <Input
            id="cad-target"
            type="date"
            min={allocationDate}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
      </FieldRow>
      <Field label="Remarks" htmlFor="cad-alloc-remarks" className="mt-3">
        <Textarea id="cad-alloc-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <Problem text={problem} />
    </Sheet>
  );
}

// ===========================================================================
// DISPATCH
// ===========================================================================

export function DispatchSheet({
  row,
  origin,
  onClose,
}: {
  row: CadStyleRow;
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const version = latestVersion(row.versions)!;
  const today = istToday();
  const [date, setDate] = useState(today);
  const [courier, setCourier] = useState("");
  const [emailAt, setEmailAt] = useState("");
  const [layout, setLayout] = useState<LayoutType | "">(row.layout_type ?? "");
  const [remarks, setRemarks] = useState("");
  const [files, setFiles] = useState<CadFileInput[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const expected =
    date && row.customer_review_days != null
      ? (() => {
          const d = new Date(`${date}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + row.customer_review_days!);
          return d.toISOString().slice(0, 10);
        })()
      : null;

  // Uploaded but never recorded — clean up on Cancel (the files are in storage
  // from the moment they were picked).
  function cancel() {
    if (!saved && files.length > 0) void discardCadUploads(files.map((f) => f.storage_path));
    onClose();
  }

  function save() {
    const why = dispatchProblem(
      {
        dispatch_date: date || null,
        courier_tracking_no: courier || null,
        email_sent_at: emailAt || null,
        layout_type: layout || null,
        files,
      },
      version,
      today,
    );
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    start(async () => {
      const r = await dispatchCad({
        allocation_id: version.id,
        dispatch_date: date,
        courier_tracking_no: courier,
        email_sent_at: emailAt,
        layout_type: layout || null,
        remarks,
        files,
      });
      if (!r.ok) {
        setProblem(r.error);
        return;
      }
      setSaved(true);
      toast.success(`CAD V${version.version_no} dispatched`);
      onClose();
    });
  }

  return (
    <Sheet
      open
      onClose={cancel}
      title={`Dispatch CAD — V${version.version_no}`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={cancel}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Record dispatch"}
          </Button>
        </>
      }
    >
      <Subject
        row={row}
        extra={
          <>
            <dt className="text-muted-foreground">Pattern Maker</dt>
            <dd>
              {version.pattern_maker_name ?? "—"} · {cadTypeLabel(version.cad_type)}
            </dd>
          </>
        }
      />
      <FieldRow>
        <Field label="Dispatch Date" required w="code" htmlFor="cad-disp-date">
          <Input
            id="cad-disp-date"
            type="date"
            min={version.allocation_date}
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field
          label="Expected Approval"
          w="code"
          htmlFor="cad-expected"
          hint={row.customer_review_days == null ? "Set CAD Review Days on the Customer" : `+${row.customer_review_days} days`}
        >
          <Input id="cad-expected" readOnly value={expected ? fmtDate(expected) : ""} />
        </Field>
      </FieldRow>
      <p className="mt-3 text-xs font-medium text-muted-foreground">Proof of dispatch — at least one</p>
      <FieldRow className="mt-1">
        <Field label="Courier Tracking No" w="term" htmlFor="cad-courier">
          {/* caps-input: exempt -- a courier tracking number is matched case-sensitively by some carriers' sites */}
          <Input id="cad-courier" uppercase={false} value={courier} onChange={(e) => setCourier(e.target.value)} />
        </Field>
        <Field label="Email Timestamp" w="term" htmlFor="cad-email-at">
          <Input
            id="cad-email-at"
            type="datetime-local"
            value={emailAt}
            onChange={(e) => setEmailAt(e.target.value)}
          />
        </Field>
      </FieldRow>
      <FieldRow className="mt-3">
        <Field
          label="Layout Type"
          required={version.cad_type === "marker_planning"}
          w="code"
          htmlFor="cad-layout"
          hint={row.layout_type ? `Order: ${layoutLabel(row.layout_type)}` : undefined}
        >
          <Select id="cad-layout" value={layout} onChange={(e) => setLayout(e.target.value as LayoutType | "")}>
            <option value="" />
            {LAYOUT_TYPES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>
      <Field label="CAD Files" required className="mt-3">
        <CadFileUpload
          files={files}
          onChange={setFiles}
          orderId={row.garment_order_id}
          styleRef={row.style_ref_no}
          versionNo={version.version_no}
        />
      </Field>
      <Field label="Remarks" htmlFor="cad-disp-remarks" className="mt-3">
        <Textarea id="cad-disp-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <Problem text={problem} />
    </Sheet>
  );
}

// ===========================================================================
// DECISION
// ===========================================================================

export function DecisionSheet({
  row,
  origin,
  onClose,
}: {
  row: CadStyleRow;
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const version = latestVersion(row.versions)!;
  const dispatch = version.dispatch!;
  const today = istToday();
  const [status, setStatus] = useState<"" | "approved" | "rework">("");
  const [decidedOn, setDecidedOn] = useState(today);
  const [comments, setComments] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function save() {
    const why = decisionProblem(
      { status: status || null, decided_on: decidedOn || null, buyer_comments: comments || null },
      dispatch,
      row.layout_type,
      row.style_ref_no,
      today,
    );
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    start(async () => {
      const r = await decideCad({
        dispatch_id: dispatch.id,
        status: status as "approved" | "rework",
        decided_on: decidedOn,
        buyer_comments: comments,
      });
      if (!r.ok) {
        setProblem(r.error);
        return;
      }
      toast.success(status === "approved" ? `CAD V${version.version_no} approved` : "Sent back for rework");
      onClose();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Buyer decision — V${version.version_no}`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Record decision"}
          </Button>
        </>
      }
    >
      <Subject
        row={row}
        extra={
          <>
            <dt className="text-muted-foreground">Dispatched</dt>
            <dd>
              {fmtDate(dispatch.dispatch_date)} · {layoutLabel(dispatch.layout_type)}
              {dispatch.expected_approval_date ? ` · expected by ${fmtDate(dispatch.expected_approval_date)}` : ""}
            </dd>
          </>
        }
      />
      <FieldRow>
        <Field label="Decision" required w="term" htmlFor="cad-decision">
          <Select
            id="cad-decision"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | "approved" | "rework")}
          >
            <option value="" />
            <option value="approved">Approved</option>
            <option value="rework">Rework Required</option>
          </Select>
        </Field>
        <Field label="Decision Date" required w="code" htmlFor="cad-decided-on">
          <Input
            id="cad-decided-on"
            type="date"
            min={dispatch.dispatch_date}
            max={today}
            value={decidedOn}
            onChange={(e) => setDecidedOn(e.target.value)}
          />
        </Field>
      </FieldRow>
      <Field
        label="Buyer Alteration Comments"
        required={status === "rework"}
        htmlFor="cad-comments"
        className="mt-3"
        hint={status === "rework" ? "What the buyer asked to change — it goes to the next version" : undefined}
      >
        <Textarea id="cad-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
      {status === "approved" && (
        <p className="mt-3 text-xs text-muted-foreground">
          Approving marks this version submitted. When every style of the order is approved, its Fabric BOM can be
          created.
        </p>
      )}
      <Problem text={problem} />
    </Sheet>
  );
}

// ===========================================================================
// HISTORY
// ===========================================================================

export function HistorySheet({
  row,
  origin,
  onClose,
}: {
  row: CadStyleRow;
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const state = cadStateOf(row.versions);
  const versions = [...row.versions].sort((a, b) => b.version_no - a.version_no);
  return (
    <Sheet open onClose={onClose} title={`CAD history — ${row.style_ref_no}`} size="md" alignToPane origin={origin}>
      <Subject
        row={row}
        extra={
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusPill tone={CAD_STATE_META[state].tone}>{CAD_STATE_META[state].label}</StatusPill>
            </dd>
          </>
        }
      />
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No CAD has been allocated for this style yet.</p>
      ) : (
        <ol className="space-y-3">
          {versions.map((v) => (
            <VersionCard key={v.id} v={v} onError={setError} />
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function VersionCard({ v, onError }: { v: CadVersion; onError: (e: string | null) => void }) {
  const d = v.dispatch;
  const decision = v.decision;
  const tone =
    decision?.status === "approved" ? "success" : decision?.status === "rework" ? "danger" : d ? "warning" : "info";
  const word =
    decision?.status === "approved"
      ? "Approved"
      : decision?.status === "rework"
        ? "Rework required"
        : d
          ? "Awaiting buyer"
          : "Allocated";
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">V{v.version_no}</span>
        <StatusPill tone={tone}>{word}</StatusPill>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">Pattern Maker</dt>
        <dd>
          {v.pattern_maker_name ?? "—"} · {cadTypeLabel(v.cad_type)}
        </dd>
        <dt className="text-muted-foreground">Allocated</dt>
        <dd>
          {fmtDate(v.allocation_date)} · target {fmtDate(v.target_date)}
        </dd>
        {v.remarks && (
          <>
            <dt className="text-muted-foreground">Remarks</dt>
            <dd>{v.remarks}</dd>
          </>
        )}
        {d && (
          <>
            <dt className="text-muted-foreground">Dispatched</dt>
            <dd>
              {fmtDate(d.dispatch_date)} · {layoutLabel(d.layout_type)}
              {d.expected_approval_date ? ` · expected ${fmtDate(d.expected_approval_date)}` : ""}
            </dd>
            <dt className="text-muted-foreground">Proof</dt>
            <dd>
              {[d.courier_tracking_no && `Courier ${d.courier_tracking_no}`, d.email_sent_at && `Email ${fmtDateTime(d.email_sent_at)}`]
                .filter(Boolean)
                .join(" · ") || "—"}
            </dd>
            <dt className="text-muted-foreground">Files</dt>
            <dd className="space-y-0.5">
              {d.files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="block text-left text-primary hover:underline"
                  onClick={async () => onError(await downloadCadFile(f.storage_path, f.file_name))}
                >
                  {f.file_name} <span className="text-xs text-muted-foreground">{prettySize(f.size_bytes)}</span>
                </button>
              ))}
            </dd>
          </>
        )}
        {decision && decision.status !== "pending" && (
          <>
            <dt className="text-muted-foreground">Decided</dt>
            <dd>{fmtDate(decision.decided_on)}</dd>
            {decision.buyer_comments && (
              <>
                <dt className="text-muted-foreground">Buyer comments</dt>
                <dd>{decision.buyer_comments}</dd>
              </>
            )}
          </>
        )}
      </dl>
    </li>
  );
}
