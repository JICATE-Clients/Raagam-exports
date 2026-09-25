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
 * with a rule unmet shows the rule's sentence (`allocationProblemAt` …, the
 * same words the database raises) UNDER THE FIELD IT IS ABOUT — never in a box
 * above the footer, where the operator has to work out which field it means.
 * After the first press the check re-runs on every render, so the message
 * leaves as soon as the field is put right. Only what no field owns (the
 * layout mismatch, a server failure) still stands above the footer.
 *
 * WIDTHS BY THE KIND OF VALUE (raagam-screen-layout, "BUILD IT COMPACT"):
 * `FieldRow` + `<Field w=…>` — a date is `code`, a pick-list `term`, a person
 * `name`. `sm` leaves ~408px of content, so each row is summed to fit it:
 * term 176 + code 144 + gap 12 = 332. `align="start"` on every row, because
 * each can carry a hint or an error under its control.
 *
 * THE ORDER, STYLE AND SYSTEM DATES ARE FACTS, NOT FIELDS (`Facts`). The
 * Allocation Date used to be a read-only box with a "System date" hint — a
 * field nobody can type into, describing its own box. It is a fact line now.
 *
 * `size="sm"`: each is a short form over the listing (AGENTS.md "A sub-detail
 * Sheet's size" — a hand-laid form with no ChildGrid, so `md`'s width would
 * only be blank space). History is `md`: it lays versions side by side in a
 * table of facts.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldRow } from "@/components/ui/field";
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
  allocationProblemAt,
  CAD_STATE_META,
  CAD_TYPES,
  cadStateOf,
  cadTypeLabel,
  decisionProblemAt,
  dispatchProblemAt,
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
import { CadFormFrame } from "./cad-form-frame";
import { DetailSection } from "@/components/masters/detail-section";
import {
  PatternDetailsFields,
  patternDetailsFrom,
  patternDetailsPayload,
  patternFactLines,
} from "./cad-pattern-fields";

/**
 * " (Version 2)" from the second version on; nothing on the first. A first
 * pattern has no other version to tell it apart from, and a bare "V1" in the
 * title read as noise (user 2026-09-25, screenshot 3061).
 */
function versionWord(n: number): string {
  return n > 1 ? ` (Version ${n})` : "";
}

/** A refusal no field owns — the layout mismatch, or the server's own answer. */
function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
      {text}
    </p>
  );
}

/** The message for `field`, or nothing — what `<Field error>` takes. */
function errorFor<F extends string>(p: { field: F | null; message: string } | null, field: F) {
  return p && p.field === field ? p.message : undefined;
}

/**
 * Read-only facts as label / value lines. A flex line per fact rather than a
 * two-track grid: the label column is one fixed width (`w-28`, the longest
 * label here — "Buyer comments" — at text-sm), and the value takes the rest.
 */
function Facts({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={className ?? "space-y-0.5 text-sm"}>{children}</dl>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** The order and style the sheet is about — read-only facts, never fields. */
function Subject({ row, extra, hide }: { row: CadStyleRow; extra?: React.ReactNode; hide?: boolean }) {
  // In Order Entry ▸ CAD the style's row sits right above the form, so this
  // block only repeated it (user 2026-09-25, screenshot 3060).
  if (hide) return null;
  return (
    <Facts className="mb-3 space-y-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
      <Fact label="Order">
        <span className="font-medium">{row.re_no ?? row.order_code ?? "—"}</span>
        {row.customer_name ? <span className="text-muted-foreground"> · {row.customer_name}</span> : null}
      </Fact>
      <Fact label="Style">
        <span className="font-medium">{row.style_ref_no}</span>
        {row.style_description ? <span className="text-muted-foreground"> · {row.style_description}</span> : null}
      </Fact>
      <Fact label="Layout Type">
        {row.layout_type ? layoutLabel(row.layout_type) : <span className="text-muted-foreground">Not declared on the order</span>}
      </Fact>
      {extra}
    </Facts>
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
  inline = false,
}: {
  row: CadStyleRow;
  mode: AllocationMode;
  employees: PatternMakerRow[];
  origin?: SheetOrigin | null;
  onClose: () => void;
  /** Order Entry ▸ CAD renders the form in place of a pop-up (cad-form-frame.tsx). */
  inline?: boolean;
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
  // 0632's pattern details — seeded from the previous version on Re-allocate
  // too: a rework usually changes a figure, not the whole setup.
  const [pattern, setPattern] = useState(() => patternDetailsFrom(seed));
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const makers = patternMakerOptions(employees, makerId);
  const nextVersion = mode === "edit" ? (latest?.version_no ?? 1) : (latest?.version_no ?? 0) + 1;
  const allocationDate = mode === "edit" ? (latest?.allocation_date ?? today) : today;
  const title =
    mode === "edit"
      ? `Edit CAD assignment · ${row.style_ref_no}${versionWord(nextVersion)}`
      : mode === "reallocate"
        ? `Re-assign CAD · ${row.style_ref_no}${versionWord(nextVersion)}`
        : `Assign CAD · ${row.style_ref_no}`;

  const check = () =>
    allocationProblemAt(
      {
        pattern_maker_id: makerId,
        cad_type: cadType || null,
        target_date: target || null,
        ...patternDetailsPayload(pattern),
      },
      allocationDate,
    );
  // Silent until the first Save — a freshly opened sheet is not a wall of red.
  const problem = tried ? check() : null;

  function save() {
    setTried(true);
    setServerError(null);
    if (check()) return;
    const payload = {
      garment_order_id: row.garment_order_id,
      style_ref_no: row.style_ref_no,
      pattern_maker_id: makerId!,
      cad_type: cadType as CadType,
      target_date: target,
      remarks,
      ...patternDetailsPayload(pattern),
    };
    start(async () => {
      const r = mode === "edit" && latest ? await updateCadAllocation(latest.id, payload) : await allocateCad(payload);
      if (!r.ok) {
        setServerError(r.error);
        return;
      }
      toast.success(mode === "edit" ? "Assignment updated" : `CAD assigned${versionWord(nextVersion)}`);
      onClose();
    });
  }

  const rework = mode === "reallocate" ? latest?.decision?.buyer_comments : null;

  return (
    <CadFormFrame
      inline={inline}
      open
      onClose={onClose}
      title={title}
      // md, not sm: the form carries the Component Cut Method ChildGrid (AGENTS.md
      // "A sub-detail Sheet's size" — md is right for a sheet holding a ChildGrid).
      size="md"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : mode === "edit" ? "Save" : "Assign CAD"}
          </Button>
        </>
      }
    >
      <Subject hide={inline} row={row} extra={<Fact label="Allocation Date">{fmtDate(allocationDate)}</Fact>} />
      {/* SECTIONS, NOT A LOOSE FORM (raagam-screen-layout; user 2026-09-25:
          "remaining page layout look instead of the form look"). The same
          DetailSections every Order Entry section is built from, so the tab
          reads as a section of the order, full width, rows ragged-right. */}
      <DetailSection label="CAD Allocation">
        {rework && (
          <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
            <span className="font-semibold">Buyer asked for (V{latest?.version_no}):</span> {rework}
          </p>
        )}
        {/* name 288 + term 176 + code 144 × 2 + name 288 + 4 gaps 48 = 1,088 —
            one row on the page (~1,500 pane); the md sheet wraps Remarks under. */}
        <FieldRow align="start">
          <Field
            label="Pattern Maker"
            required
            w="name"
            hint={makers.hint ?? undefined}
            error={errorFor(problem, "maker")}
          >
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
          <Field label="CAD Type" required w="term" htmlFor="cad-type" error={errorFor(problem, "type")}>
            <Select id="cad-type" value={cadType} onChange={(e) => setCadType(e.target.value as CadType | "")}>
              <option value="" />
              {CAD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Allocation Date" w="code" htmlFor="cad-alloc-date">
            <Input id="cad-alloc-date" readOnly value={fmtDate(allocationDate)} />
          </Field>
          <Field
            label="Internal Target Date"
            required
            w="code"
            htmlFor="cad-target"
            error={errorFor(problem, "target")}
          >
            <Input
              id="cad-target"
              type="date"
              min={allocationDate}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          {/* ONE ROW, Remarks included (user 2026-09-25: "this all into single
              row"). A one-line box, name 288 — a short note, not a paragraph. */}
          <Field label="Remarks" w="name" htmlFor="cad-alloc-remarks">
            <Input id="cad-alloc-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </FieldRow>
      </DetailSection>
      <PatternDetailsFields
        value={pattern}
        onChange={setPattern}
        components={row.components}
        errors={{ length: errorFor(problem, "length"), width: errorFor(problem, "width") }}
      />
      <Problem text={serverError} />
    </CadFormFrame>
  );
}

// ===========================================================================
// DISPATCH
// ===========================================================================

export function DispatchSheet({
  row,
  origin,
  onClose,
  inline = false,
}: {
  row: CadStyleRow;
  origin?: SheetOrigin | null;
  onClose: () => void;
  /** Order Entry ▸ CAD renders the form in place of a pop-up (cad-form-frame.tsx). */
  inline?: boolean;
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
  // 0632: the email slip / courier docket — proof of dispatch on its own.
  const [proofFiles, setProofFiles] = useState<CadFileInput[]>([]);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
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
    const uploaded = [...files, ...proofFiles];
    if (!saved && uploaded.length > 0) void discardCadUploads(uploaded.map((f) => f.storage_path));
    onClose();
  }

  const check = () =>
    dispatchProblemAt(
      {
        dispatch_date: date || null,
        courier_tracking_no: courier || null,
        email_sent_at: emailAt || null,
        layout_type: layout || null,
        files,
        proof_files: proofFiles,
      },
      version,
      today,
    );
  const problem = tried ? check() : null;

  function save() {
    setTried(true);
    setServerError(null);
    if (check()) return;
    start(async () => {
      const r = await dispatchCad({
        allocation_id: version.id,
        dispatch_date: date,
        courier_tracking_no: courier,
        email_sent_at: emailAt,
        layout_type: layout || null,
        remarks,
        files,
        proof_files: proofFiles,
      });
      if (!r.ok) {
        setServerError(r.error);
        return;
      }
      setSaved(true);
      toast.success(`CAD V${version.version_no} sent`);
      onClose();
    });
  }

  return (
    <CadFormFrame
      inline={inline}
      open
      onClose={cancel}
      title={`Send CAD · ${row.style_ref_no}${versionWord(version.version_no)}`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={cancel}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Send CAD"}
          </Button>
        </>
      }
    >
      <Subject hide={inline}
        row={row}
        extra={
          <Fact label="Pattern Maker">
            {version.pattern_maker_name ?? "—"} · {cadTypeLabel(version.cad_type)}
          </Fact>
        }
      />
      <DetailSection label="Dispatch">
        {/* code 144 × 3 + 2 gaps 24 = 456 — one line on the page; wraps in the sheet. */}
        <FieldRow align="start">
          <Field label="Dispatch Date" required w="code" htmlFor="cad-disp-date" error={errorFor(problem, "date")}>
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
          <Field
            label="Layout Type"
            required={version.cad_type === "marker_planning"}
            w="code"
            htmlFor="cad-layout"
            hint={row.layout_type ? `Order: ${layoutLabel(row.layout_type)}` : undefined}
            error={errorFor(problem, "layout")}
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
        <Field label="Remarks" htmlFor="cad-disp-remarks">
          <Textarea id="cad-disp-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </DetailSection>
      <DetailSection label="Proof of Dispatch — at least one">
        {/* term 176 × 2 + gap 12 = 364. The refusal names the PAIR (and the
            slip), so it sits under the section rather than under one field. */}
        <FieldRow align="start">
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
        <Field label="Transmission Proof (email slip / courier docket)">
          <CadFileUpload
            kind="proof"
            files={proofFiles}
            onChange={setProofFiles}
            orderId={row.garment_order_id}
            styleRef={row.style_ref_no}
            versionNo={version.version_no}
          />
        </Field>
        <FieldError id="cad-proof-error">{errorFor(problem, "proof")}</FieldError>
      </DetailSection>
      <DetailSection label="CAD Files">
        <Field label="Pattern files" required error={errorFor(problem, "files")}>
          <CadFileUpload
            files={files}
            onChange={setFiles}
            orderId={row.garment_order_id}
            styleRef={row.style_ref_no}
            versionNo={version.version_no}
          />
        </Field>
      </DetailSection>
      <Problem text={serverError} />
    </CadFormFrame>
  );
}

// ===========================================================================
// DECISION
// ===========================================================================

export function DecisionSheet({
  row,
  origin,
  onClose,
  inline = false,
}: {
  row: CadStyleRow;
  origin?: SheetOrigin | null;
  onClose: () => void;
  /** Order Entry ▸ CAD renders the form in place of a pop-up (cad-form-frame.tsx). */
  inline?: boolean;
}) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const version = latestVersion(row.versions)!;
  const dispatch = version.dispatch!;
  const today = istToday();
  const [status, setStatus] = useState<"" | "approved" | "rework">("");
  const [decidedOn, setDecidedOn] = useState(today);
  const [comments, setComments] = useState("");
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const check = () =>
    decisionProblemAt(
      { status: status || null, decided_on: decidedOn || null, buyer_comments: comments || null },
      dispatch,
      row.layout_type,
      row.style_ref_no,
      today,
    );
  const problem = tried ? check() : null;

  function save() {
    setTried(true);
    setServerError(null);
    if (check()) return;
    start(async () => {
      const r = await decideCad({
        dispatch_id: dispatch.id,
        status: status as "approved" | "rework",
        decided_on: decidedOn,
        buyer_comments: comments,
      });
      if (!r.ok) {
        setServerError(r.error);
        return;
      }
      toast.success(status === "approved" ? `CAD V${version.version_no} approved` : "Sent back for rework");
      onClose();
    });
  }

  return (
    <CadFormFrame
      inline={inline}
      open
      onClose={onClose}
      title={`CAD Approval · ${row.style_ref_no}${versionWord(version.version_no)}`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save CAD Approval"}
          </Button>
        </>
      }
    >
      <Subject hide={inline}
        row={row}
        extra={
          <Fact label="Dispatched">
            {fmtDate(dispatch.dispatch_date)} · {layoutLabel(dispatch.layout_type)}
            {dispatch.expected_approval_date ? ` · expected by ${fmtDate(dispatch.expected_approval_date)}` : ""}
          </Fact>
        }
      />
      <DetailSection label="Buyer Decision">
        {/* On the page the Subject block is gone, so what the buyer is answering
            — when it went, when a reply is due — are read-only fields here.
            code 144 × 3 + term 176 + 3 gaps 36 = 644. */}
        <FieldRow align="start">
          {inline && (
            <>
              <Field label="Dispatched" w="code" htmlFor="cad-dispatched-on">
                <Input id="cad-dispatched-on" readOnly value={fmtDate(dispatch.dispatch_date)} />
              </Field>
              <Field label="Expected Approval" w="code" htmlFor="cad-expected-by">
                <Input
                  id="cad-expected-by"
                  readOnly
                  value={dispatch.expected_approval_date ? fmtDate(dispatch.expected_approval_date) : ""}
                />
              </Field>
            </>
          )}
          <Field label="Decision" required w="term" htmlFor="cad-decision" error={errorFor(problem, "status")}>
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
          <Field label="Decision Date" required w="code" htmlFor="cad-decided-on" error={errorFor(problem, "date")}>
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
          hint={status === "rework" ? "What the buyer asked to change — it goes to the next version" : undefined}
          error={errorFor(problem, "comments")}
        >
          <Textarea id="cad-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
        {status === "approved" && (
          <p className="text-xs text-muted-foreground">
            Approving marks this version submitted. When every style of the order is approved, its Fabric BOM can be
            created.
          </p>
        )}
      </DetailSection>
      <Problem text={problem && problem.field === null ? problem.message : serverError} />
    </CadFormFrame>
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
          <Fact label="Status">
            <StatusPill tone={CAD_STATE_META[state].tone}>{CAD_STATE_META[state].label}</StatusPill>
          </Fact>
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
          : "Assigned";
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">V{v.version_no}</span>
        <StatusPill tone={tone}>{word}</StatusPill>
      </div>
      <Facts>
        <Fact label="Pattern Maker">
          {v.pattern_maker_name ?? "—"} · {cadTypeLabel(v.cad_type)}
        </Fact>
        <Fact label="Assigned">
          {fmtDate(v.allocation_date)} · target {fmtDate(v.target_date)}
        </Fact>
        {patternFactLines(v).map(([label, text]) => (
          <Fact key={label} label={label}>
            {text}
          </Fact>
        ))}
        {v.remarks && <Fact label="Remarks">{v.remarks}</Fact>}
        {d && (
          <>
            <Fact label="Dispatched">
              {fmtDate(d.dispatch_date)} · {layoutLabel(d.layout_type)}
              {d.expected_approval_date ? ` · expected ${fmtDate(d.expected_approval_date)}` : ""}
            </Fact>
            <Fact label="Proof">
              {[d.courier_tracking_no && `Courier ${d.courier_tracking_no}`, d.email_sent_at && `Email ${fmtDateTime(d.email_sent_at)}`]
                .filter(Boolean)
                .join(" · ") || (d.files.some((f) => f.kind === "proof") ? "" : "—")}
              {d.files
                .filter((f) => f.kind === "proof")
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="block text-left text-primary hover:underline"
                    onClick={async () => onError(await downloadCadFile(f.storage_path, f.file_name))}
                  >
                    {f.file_name} <span className="text-xs text-muted-foreground">{prettySize(f.size_bytes)}</span>
                  </button>
                ))}
            </Fact>
            <Fact label="Files">
              <span className="block space-y-0.5">
                {d.files.filter((f) => f.kind !== "proof").map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="block text-left text-primary hover:underline"
                    onClick={async () => onError(await downloadCadFile(f.storage_path, f.file_name))}
                  >
                    {f.file_name} <span className="text-xs text-muted-foreground">{prettySize(f.size_bytes)}</span>
                  </button>
                ))}
              </span>
            </Fact>
          </>
        )}
        {decision && decision.status !== "pending" && (
          <>
            <Fact label="Decided">{fmtDate(decision.decided_on)}</Fact>
            {decision.buyer_comments && <Fact label="Buyer comments">{decision.buyer_comments}</Fact>}
          </>
        )}
      </Facts>
    </li>
  );
}
