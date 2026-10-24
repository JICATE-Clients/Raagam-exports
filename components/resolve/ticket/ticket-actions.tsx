"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CirclePlay,
  CircleSlash,
  Hand,
  MessageSquarePlus,
  Pencil,
  Repeat,
  ShieldCheck,
  ThumbsDown,
  Undo2,
  UserCheck,
  UserPlus,
  Wrench,
  Check,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  assignTickets,
  blockTicket,
  cancelTicket,
  claimTicket,
  disputeTicket,
  editReport,
  fixTicket,
  joinTicket,
  ownerConfirm,
  rateTicket,
  reclassifyTicket,
  spotCheck,
  startTicket,
  unblockTicket,
  withdrawTicket,
  addNote,
  assignComplaint,
  resolveComplaint,
  startComplaint,
  withdrawComplaint,
} from "@/lib/resolve/actions";
import type {
  NoteVisibility,
  Priority,
  Severity,
  TicketAction,
  TicketListRow,
} from "@/lib/resolve/types";
import { PhotoCapture, type CapturedPhoto } from "@/components/resolve/report/photo-capture";
import { StarRating } from "./star-rating";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** A dialog the panel can open. Notes are one dialog for both visibilities. */
type Dialog =
  | "assign"
  | "block"
  | "fix"
  | "spot_check"
  | "owner_confirm"
  | "dispute"
  | "cancel"
  | "withdraw"
  | "edit_report"
  | "reclassify"
  | "note"
  | "c_assign"
  | "c_resolve"
  | "c_withdraw";

const BUTTON: Partial<Record<TicketAction, { label: string; icon: LucideIcon }>> = {
  start: { label: "Start work", icon: CirclePlay },
  fix: { label: "Mark fixed", icon: Wrench },
  spot_check: { label: "Spot check", icon: ShieldCheck },
  owner_confirm: { label: "Confirm closed", icon: Check },
  unblock: { label: "Resume work", icon: CirclePlay },
  claim: { label: "Claim this job", icon: Hand },
  assign: { label: "Assign", icon: UserCheck },
  block: { label: "Mark blocked", icon: CircleSlash },
  join: { label: "I have this problem too", icon: UserPlus },
  dispute: { label: "Not fixed", icon: ThumbsDown },
  edit_report: { label: "Edit my report", icon: Pencil },
  reclassify: { label: "Reclassify", icon: Repeat },
  withdraw: { label: "Withdraw", icon: Undo2 },
  cancel: { label: "Cancel report", icon: Ban },
  // complaints (plan §10.5)
  c_start: { label: "Start handling", icon: CirclePlay },
  c_resolve: { label: "Resolve", icon: Check },
  c_assign: { label: "Assign", icon: UserCheck },
  c_withdraw: { label: "Withdraw complaint", icon: Undo2 },
};

/** The order buttons are drawn in — the next step of the work first. */
const ORDER: TicketAction[] = [
  "c_start",
  "c_resolve",
  "c_assign",
  "start",
  "fix",
  "spot_check",
  "owner_confirm",
  "unblock",
  "claim",
  "assign",
  "block",
  "join",
  "dispute",
  "edit_report",
  "reclassify",
  "withdraw",
  "c_withdraw",
  "cancel",
];

/** The one FILLED button: the first of these the viewer may do (one filled per screen). */
const PRIMARY: TicketAction[] = [
  "fix",
  "start",
  "spot_check",
  "owner_confirm",
  "unblock",
  "claim",
  "c_resolve",
  "c_start",
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * THE NEXT-ACTION PANEL — exactly `detail.actions`, never re-derived.
 *
 * `rh_ticket_actions` decides who may do what; this only draws a button per
 * answer and calls the matching action, which the RPC re-checks anyway. A
 * button the server did not list is never drawn, so the panel cannot offer a
 * click the database will refuse.
 *
 * Every action ends the same way: a toast in the server's words, and
 * `router.refresh()` so the page re-reads the ticket (and therefore the next
 * list of actions). Irreversible ones confirm first; ones that need a reason
 * open a small sheet whose reason is mandatory.
 */
export function TicketActions({
  ticket,
  actions,
  trades,
  people,
  myRating,
}: {
  ticket: TicketListRow;
  actions: TicketAction[];
  trades: { id: string; name: string }[];
  people: { id: string; name: string }[];
  myRating: { stars: number; comment: string | null } | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // One set of dialog fields, reset each time a dialog opens.
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [assignee, setAssignee] = useState("");
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description ?? "");
  const [tradeId, setTradeId] = useState(ticket.trade_id ?? "");
  const [severity, setSeverity] = useState<Severity>(ticket.severity);
  const [priority, setPriority] = useState<Priority>(ticket.priority);
  const [routine, setRoutine] = useState(ticket.is_routine);
  const [visibility, setVisibility] = useState<NoteVisibility>(
    actions.includes("note_internal") ? "internal" : "reporter",
  );
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");

  const has = (a: TicketAction) => actions.includes(a);
  const canRate = has("rate") && !myRating;
  useUnsavedGuard((canRate && (stars > 0 || comment.trim() !== "")) || isPending);

  const primary = PRIMARY.find(has) ?? null;
  const buttons = ORDER.filter((a) => has(a) && BUTTON[a]);
  const canNote = has("note_internal") || has("note_reporter");

  const peopleOptions = useMemo<ComboboxOption[]>(
    () => people.map((p) => ({ value: p.id, label: p.name })),
    [people],
  );
  const tradeOptions = useMemo<ComboboxOption[]>(
    () => [{ value: "", label: "Not sure (needs sorting)" }, ...trades.map((t) => ({ value: t.id, label: t.name }))],
    [trades],
  );

  function open(d: Dialog) {
    setReason("");
    setNote("");
    setPhoto(null);
    setAssignee(ticket.assignee_id ?? "");
    setTitle(ticket.title);
    setDescription(ticket.description ?? "");
    setTradeId(ticket.trade_id ?? "");
    setSeverity(ticket.severity);
    setPriority(ticket.priority);
    setRoutine(ticket.is_routine);
    setDialog(d);
  }

  function run<T>(call: () => Promise<Result<T>>, done: (data: T) => string) {
    startTransition(async () => {
      const res = await call();
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setDialog(null);
      setConfirmCancel(false);
      success(done(res.data));
      router.refresh();
    });
  }

  function click(a: TicketAction) {
    switch (a) {
      case "start":
        return run(() => startTicket(ticket.id), () => "Work started. The reporter can see it is in hand.");
      case "c_start":
        return run(() => startComplaint(ticket.id), () => "Marked as being handled. The response time is met.");
      case "c_assign":
      case "c_resolve":
      case "c_withdraw":
        return open(a);
      case "unblock":
        return run(() => unblockTicket(ticket.id), () => "Work resumed. The due date moved by the time it was blocked.");
      case "claim":
        return run(() => claimTicket(ticket.id), () => "This job is yours now.");
      case "join":
        return run(() => joinTicket(ticket.id), () => "You have joined this report. You will be told when it is fixed.");
      case "assign":
      case "block":
      case "fix":
      case "spot_check":
      case "owner_confirm":
      case "dispute":
      case "cancel":
      case "withdraw":
      case "edit_report":
      case "reclassify":
        return open(a);
      default:
        return undefined;
    }
  }

  function submitFix() {
    if (!photo) return;
    const fd = new FormData();
    fd.set("id", ticket.id);
    fd.set("note", note.trim());
    fd.set("photo", photo.file);
    run(
      () => fixTicket(fd),
      (d) =>
        d.spot_check
          ? "Marked fixed. A spot check will confirm it before it closes."
          : "Marked fixed and closed. The reporter has been told.",
    );
  }

  const dialogs: Record<Dialog, { title: string; confirm: string; tone?: "danger"; ok: boolean; go: () => void; body: ReactNode }> = {
    assign: {
      title: "Assign this job",
      confirm: "Assign",
      ok: !!assignee,
      go: () => run(() => assignTickets([ticket.id], assignee), () => "Assigned."),
      body: (
        <Field label="Assign to" required>
          <Combobox options={peopleOptions} value={assignee} onChange={setAssignee} />
        </Field>
      ),
    },
    block: {
      title: "Why is this blocked?",
      confirm: "Mark blocked",
      ok: reason.trim().length >= 3,
      go: () => run(() => blockTicket(ticket.id, reason.trim()), () => "Marked blocked. The clock is paused until work resumes."),
      body: (
        <Field label="Reason" required hint="For example: waiting for a part, or the room is locked.">
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ),
    },
    fix: {
      title: "Mark fixed",
      confirm: "Mark fixed",
      ok: !!photo,
      go: submitFix,
      body: (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Photo of the fix</p>
            <PhotoCapture value={photo} onChange={setPhoto} zIndexBase={120} takeLabel="Take photo of the fix" />
            <p className="text-xs text-muted-foreground">A photo of the finished work is required.</p>
          </div>
          <Field label="Note">
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ),
    },
    spot_check: {
      title: "Spot check",
      confirm: "Record spot check",
      ok: true,
      go: () => undefined,
      body: (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Look at the fix in person. Passing closes the report; failing sends it back to the
            fixer with a fresh due date, and needs a note saying what is still wrong.
          </p>
          <Field label="Note">
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ),
    },
    owner_confirm: {
      title: "Confirm closed",
      confirm: "Confirm closed",
      ok: true,
      go: () => run(() => ownerConfirm(ticket.id, note.trim()), () => "Closed on your confirmation."),
      body: (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Closes the report on your word rather than a spot check. It is counted separately from
            photo-verified fixes.
          </p>
          <Field label="Note">
            <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ),
    },
    dispute: {
      title: "Not fixed?",
      confirm: "Reopen as not fixed",
      tone: "danger",
      ok: reason.trim().length >= 3,
      go: () => run(() => disputeTicket(ticket.id, reason.trim()), () => "Reopened. It goes back to the fixer with a fresh due date."),
      body: (
        <Field label="What is still wrong" required>
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ),
    },
    cancel: {
      title: "Cancel this report",
      confirm: "Cancel report",
      tone: "danger",
      ok: reason.trim().length >= 3,
      // The sheet closes first and the confirm opens on its own — the reason
      // is kept in state, so the two never stack on one another.
      go: () => {
        setDialog(null);
        setConfirmCancel(true);
      },
      body: (
        <Field label="Reason" required hint="The reporter sees this reason.">
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ),
    },
    withdraw: {
      title: "",
      confirm: "",
      ok: true,
      go: () => undefined,
      body: null,
    },
    edit_report: {
      title: "Edit my report",
      confirm: "Save changes",
      ok: title.trim() !== "",
      go: () => run(() => editReport(ticket.id, title.trim(), description.trim()), () => "Report updated."),
      body: (
        <div className="space-y-3">
          <Field label="What is wrong" required>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Details">
            <Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      ),
    },
    reclassify: {
      title: "Reclassify",
      confirm: "Save",
      ok: true,
      go: () =>
        run(
          () =>
            reclassifyTicket(ticket.id, {
              trade_id: tradeId || null,
              severity,
              priority,
              is_routine: routine,
            }),
          () => "Reclassified. Routing and the due date were recalculated.",
        ),
      body: (
        <div className="space-y-3">
          <Field label="Trade">
            <Combobox options={tradeOptions} value={tradeId} onChange={setTradeId} />
          </Field>
          <FieldRow>
            <Field label="Severity" w="code">
              <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {cap(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" w="code">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {cap(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Toggle checked={routine} onChange={setRoutine} label="Routine job (longer due date)" />
        </div>
      ),
    },
    c_assign: {
      title: "Assign this complaint",
      confirm: "Assign",
      ok: !!assignee,
      go: () => run(() => assignComplaint(ticket.id, assignee), () => "Assigned."),
      body: (
        <Field label="Assign to" required hint="Pick someone outside the complainant's reporting line.">
          <Combobox options={peopleOptions} value={assignee} onChange={setAssignee} />
        </Field>
      ),
    },
    c_resolve: {
      title: "Resolve this complaint",
      confirm: "Resolve",
      ok: reason.trim().length >= 3,
      go: () =>
        run(
          () => resolveComplaint(ticket.id, reason.trim()),
          () => "Resolved. The complainant can now read your reply.",
        ),
      body: (
        <Field
          label="Reply to the complainant"
          required
          hint={
            ticket.is_anonymous
              ? "This is exactly what the complainant sees on their tracking page. Do not include internal details."
              : "This is exactly what the complainant sees. Do not include internal details."
          }
        >
          <Textarea rows={5} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ),
    },
    c_withdraw: {
      title: "",
      confirm: "",
      ok: true,
      go: () => undefined,
      body: null,
    },
    note: {
      title: "Add a note",
      confirm: "Add note",
      ok: note.trim() !== "",
      go: () =>
        run(
          () => addNote(ticket.id, note.trim(), visibility),
          () => (visibility === "internal" ? "Internal note added." : "Note added. The reporter can see it."),
        ),
      body: (
        <div className="space-y-3">
          {has("note_internal") && has("note_reporter") ? (
            <Field label="Who can see it">
              <Segmented<NoteVisibility>
                name={`rh-note-vis-${ticket.id}`}
                value={visibility}
                onChange={setVisibility}
                options={[
                  { value: "internal", label: "Staff only" },
                  { value: "reporter", label: "Reporter too" },
                ]}
              />
            </Field>
          ) : null}
          <Field label="Note" required>
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      ),
    },
  };

  const active = dialog && dialog !== "withdraw" && dialog !== "c_withdraw" ? dialogs[dialog] : null;

  if (buttons.length === 0 && !canNote && !canRate && !myRating) {
    return <p className="text-sm text-muted-foreground">Nothing for you to do here right now.</p>;
  }

  return (
    <div className="space-y-4">
      {buttons.length > 0 || canNote ? (
        <div className="flex flex-wrap gap-2">
          {buttons.map((a) => {
            const b = BUTTON[a]!;
            const Icon = b.icon;
            return (
              <Button
                key={a}
                type="button"
                variant={a === primary ? "primary" : "outline"}
                disabled={isPending}
                onClick={() => click(a)}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {b.label}
              </Button>
            );
          })}
          {canNote ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setVisibility(has("note_internal") ? "internal" : "reporter");
                open("note");
              }}
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
              Add note
            </Button>
          ) : null}
        </div>
      ) : null}

      {myRating ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Your rating</p>
          <StarRating value={myRating.stars} onChange={() => {}} name={`rh-rated-${ticket.id}`} disabled />
          {myRating.comment ? <p className="text-sm text-muted-foreground">{myRating.comment}</p> : null}
        </div>
      ) : canRate ? (
        <form
          data-focus-scope
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (stars < 1) return;
            run(
              () => rateTicket(ticket.id, stars, comment.trim()),
              () => "Thank you — your rating was sent to the person who fixed it.",
            );
          }}
        >
          <p className="text-sm font-medium text-foreground">Say thanks — rate the fix</p>
          <StarRating value={stars} onChange={setStars} name={`rh-rate-${ticket.id}`} disabled={isPending} />
          <Field label="Comment">
            <Textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant={primary ? "outline" : "primary"} disabled={isPending || stars < 1}>
              Send rating
            </Button>
          </div>
        </form>
      ) : null}

      <Sheet
        open={active !== null}
        onClose={() => setDialog(null)}
        title={active?.title ?? ""}
        size="sm"
        footer={
          active ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={isPending}>
                Back
              </Button>
              {dialog === "spot_check" ? (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    // Failing needs a reason the fixer can act on (the action refuses without one).
                    disabled={isPending || !note.trim()}
                    onClick={() => run(() => spotCheck(ticket.id, false, note.trim()), () => "Spot check failed. Sent back to the fixer.")}
                  >
                    Not fixed
                  </Button>
                  <Button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => spotCheck(ticket.id, true, note.trim()), () => "Spot check passed. The report is closed.")}
                  >
                    Passed
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant={active.tone === "danger" ? "danger" : "primary"}
                  disabled={isPending || !active.ok}
                  onClick={active.go}
                >
                  {isPending ? "Working…" : active.confirm}
                </Button>
              )}
            </div>
          ) : null
        }
      >
        {active?.body}
      </Sheet>

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel ${ticket.ref_no}?`}
        body="The report is closed without being fixed and the reporter is told why. This cannot be undone."
        confirmLabel="Cancel report"
        cancelLabel="Keep it"
        tone="danger"
        isPending={isPending}
        onConfirm={() => run(() => cancelTicket(ticket.id, reason.trim()), () => "Report cancelled.")}
        onCancel={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        open={dialog === "c_withdraw"}
        title={`Withdraw ${ticket.ref_no}?`}
        body="The handler stops working on it and it is closed as withdrawn. This cannot be undone — you would need to send a new complaint."
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        tone="danger"
        isPending={isPending}
        onConfirm={() => run(() => withdrawComplaint(ticket.id), () => "Complaint withdrawn.")}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === "withdraw"}
        title={`Withdraw ${ticket.ref_no}?`}
        body="Use this if the problem has gone away or was reported by mistake. Nobody will work on it."
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        tone="danger"
        isPending={isPending}
        onConfirm={() => run(() => withdrawTicket(ticket.id), () => "Report withdrawn.")}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
