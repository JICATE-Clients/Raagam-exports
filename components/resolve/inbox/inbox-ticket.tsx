"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Info, Keyboard, MoreHorizontal, Star, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { PhotoCapture, type CapturedPhoto } from "@/components/resolve/report/photo-capture";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  addNote,
  assignTickets,
  blockTicket,
  cancelTicket,
  claimTicket,
  disputeTicket,
  fixTicket,
  ownerConfirm,
  rateTicket,
  resolveComplaint,
  spotCheck,
  startComplaint,
  startTicket,
  unblockTicket,
  withdrawComplaint,
  withdrawTicket,
  assignComplaint,
} from "@/lib/resolve/actions";
import {
  assignServiceTickets,
  cancelServiceTicket,
  claimServiceTicket,
  confirmServiceTicket,
  holdServiceTicket,
  reopenServiceTicket,
  resolveServiceTicket,
  resumeServiceTicket,
  startServiceTicket,
  withdrawServiceTicket,
} from "@/lib/resolve/desk-actions";
import { decideRequirement, fulfilRequirement, withdrawRequirement } from "@/lib/resolve/assist-actions";
import { inboxPeople } from "@/lib/resolve/inbox-actions";
import { LANE_OF_KIND } from "@/lib/resolve/inbox-types";
import type { TicketAction, TicketDetail } from "@/lib/resolve/types";
import { cn } from "@/lib/utils";
import { Chip, LaneTile, StepChain } from "./inbox-bits";
import {
  CANCEL_REASONS,
  CONCERN_ANSWERS,
  FIX_DONE,
  GIVE_NOTES,
  HOLD_REASONS,
  IT_CAUSE,
  IT_FIX,
  QUICK_NOTE,
  QUICK_REPLY,
  RAISER_QUICK,
  REJECT_REASONS,
  REOPEN_REASONS,
  SPOT_NOTES,
  stepButtons,
  stepOf,
  type PanelKind,
  type StepButton,
} from "./inbox-flow";
import { TicketFeed } from "./ticket-feed";

type Outcome = { ok: true } | { ok: false; error: string };
type Run = (fn: () => Promise<Outcome>, done: string) => void;

/** Shared by both panes: run a step, say what happened, reload the ticket. */
function useRun(onChanged: () => void): { run: Run; isPending: boolean } {
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const run: Run = (fn, done) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        success(done);
        onChanged();
      } else error(res.error);
    });
  return { run, isPending };
}

function Header({
  detail,
  onBack,
  onMore,
  children,
}: {
  detail: TicketDetail;
  onBack: () => void;
  /** On the ticket page: opens the details and the rarer actions. */
  onMore?: () => void;
  children?: ReactNode;
}) {
  const t = detail.ticket;
  const lane = LANE_OF_KIND[t.kind];
  const who = t.is_anonymous ? "Anonymous" : t.reporter_name;
  const facts = [
    t.place_name,
    who,
    t.kind === "complaint" ? t.category_name : t.team_name ?? t.trade_name,
    t.kind === "requirement" && t.rq_qty ? `Qty ${t.rq_qty}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-3.5 pb-2.5 pt-3">
      <div className="flex items-start gap-2.5">
        <Button variant="outline" size="sm" className="w-8 px-0 md:hidden" onClick={onBack} aria-label="Back to the list">
          <ChevronLeft aria-hidden="true" />
        </Button>
        <LaneTile lane={lane} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-snug text-balance">
            {t.is_dangerous && <TriangleAlert className="mr-1 inline size-4 text-danger" aria-label="Dangerous" />}
            {t.title}
          </h2>
          <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{t.ref_no}</span>
            {facts.map((f) => (
              <span key={f as string}>· {f}</span>
            ))}
          </p>
        </div>
        {onMore && (
          <Button variant="outline" size="sm" className="w-8 px-0" onClick={onMore} aria-label="Details and other actions" title="Details">
            <Info aria-hidden="true" />
          </Button>
        )}
      </div>
      <StepChain lane={lane} state={stepOf(t)} />
      {children}
    </div>
  );
}

/** An inline form for one step — opened in place, never a dialog. */
function Panel({
  title,
  onClose,
  why,
  confirm,
  canConfirm,
  onConfirm,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  why: string;
  confirm: string;
  canConfirm: boolean;
  onConfirm: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-primary bg-primary-soft p-2.5" data-focus-scope>
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold">{title}</p>
        <Button variant="ghost" size="sm" className="w-8 px-0" onClick={onClose} aria-label="Close">
          <X aria-hidden="true" />
        </Button>
      </div>
      {children}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{why}</p>
        <Button size="sm" disabled={!canConfirm || busy} onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </div>
  );
}

function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <p className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-danger"> *</span>}
    </p>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

// =====================================================================================
// RESOLVER
// =====================================================================================

export function ResolverPane({
  detail,
  meId,
  onBack,
  onChanged,
  onMore,
}: {
  detail: TicketDetail;
  meId: string;
  onBack: () => void;
  onChanged: () => void;
  /** Set on the ticket page, where "Open full page" would point at itself. */
  onMore?: () => void;
}) {
  const t = detail.ticket;
  const lane = LANE_OF_KIND[t.kind];
  const { run, isPending } = useRun(onChanged);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<string | null>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState<string | null>(null);
  const dirty = !!photo || !!typed?.trim() || !!draft?.trim() || Object.values(picks).some((v) => v.length > 0);
  useUnsavedGuard(dirty || isPending);

  const { primary, side } = stepButtons(detail.actions);
  const has = (a: TicketAction) => detail.actions.includes(a);
  const canReply = has("note_reporter");
  const canNote = has("note_internal");
  const visibleSide = side[0] ?? null;
  const moreSide = side.slice(1);

  function open(p: PanelKind) {
    setPanel(p);
    setPicks({});
    setTyped(null);
    setPhoto(null);
    setMenu(false);
    if (p === "assign" && people === null) {
      inboxPeople().then((r) => setPeople(r.ok ? r.data.filter((x) => x.id !== t.assignee_id) : []));
    }
  }
  function close() {
    setPanel(null);
    setPicks({});
    setTyped(null);
    setPhoto(null);
  }
  const picked = (key: string) => picks[key] ?? [];
  function toggle(key: string, v: string, multi: boolean) {
    setPicks((p) => {
      const cur = p[key] ?? [];
      const next = multi ? (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]) : cur[0] === v ? [] : [v];
      return { ...p, [key]: next };
    });
  }
  /** The chips' words joined into the sentence that is saved, plus anything typed. */
  const words = (key: string) => [...picked(key), typed?.trim() || null].filter(Boolean).join(", ");
  const done = () => close();

  function oneTap(b: StepButton) {
    const id = t.id;
    const ref = t.ref_no;
    switch (b.action) {
      case "claim":
        return run(() => claimTicket(id), `${ref} is yours.`);
      case "sd_claim":
        return run(() => claimServiceTicket(id), `${ref} is yours.`);
      case "unblock":
        return run(() => unblockTicket(id), `${ref} resumed — the clock runs again.`);
      case "sd_resume":
        return run(() => resumeServiceTicket(id), `${ref} resumed — the clock runs again.`);
      case "start":
        return run(() => startTicket(id), `${ref} started.`);
      case "sd_start":
        return run(() => startServiceTicket(id), `${ref} started — the requester is told.`);
      case "c_start":
        return run(() => startComplaint(id), `${ref} started.`);
      case "rq_approve":
        return run(() => decideRequirement(id, true, null), `${ref} approved.`);
      case "owner_confirm":
        return run(() => ownerConfirm(id, null), `${ref} closed.`);
      default:
        return undefined;
    }
  }

  function confirmPanel() {
    const id = t.id;
    const ref = t.ref_no;
    switch (panel) {
      case "fix": {
        const fd = new FormData();
        fd.set("id", id);
        if (words("did")) fd.set("note", words("did"));
        if (photo) fd.set("photo", photo.file);
        return run(async () => {
          const r = await fixTicket(fd);
          if (r.ok) done();
          return r;
        }, `${ref} marked fixed — ${t.reporter_name ?? "the raiser"} is asked to confirm.`);
      }
      case "resolve": {
        const cause = picked("cause").join(", ");
        const fix = [...picked("fix"), typed?.trim() || null].filter(Boolean).join(", ");
        return run(async () => {
          const r = await resolveServiceTicket(id, { root_cause: cause, resolution: fix, kb_article_id: null });
          if (r.ok) done();
          return r;
        }, `${ref} resolved — the clock stopped.`);
      }
      case "answer":
        return run(async () => {
          const r = await resolveComplaint(id, words("answer"));
          if (r.ok) done();
          return r;
        }, `${ref} answered.`);
      case "give":
        return run(async () => {
          const r = await fulfilRequirement(id, words("give") || null);
          if (r.ok) done();
          return r;
        }, `${ref} marked given.`);
      case "reject":
        return run(async () => {
          const r = await decideRequirement(id, false, words("reason"));
          if (r.ok) done();
          return r;
        }, `${ref} rejected.`);
      case "hold": {
        const reason = words("reason");
        const fn = t.kind === "service" ? () => holdServiceTicket(id, reason) : () => blockTicket(id, reason);
        return run(async () => {
          const r = await fn();
          if (r.ok) done();
          return r;
        }, `${ref} paused — moved to Waiting.`);
      }
      case "cancel": {
        const reason = words("reason");
        const fn = t.kind === "service" ? () => cancelServiceTicket(id, reason) : () => cancelTicket(id, reason);
        return run(async () => {
          const r = await fn();
          if (r.ok) done();
          return r;
        }, `${ref} cancelled.`);
      }
      case "spot": {
        const pass = picked("spot")[0] === SPOT_NOTES[0];
        return run(async () => {
          const r = await spotCheck(id, pass, picked("spot")[0] ?? null);
          if (r.ok) done();
          return r;
        }, pass ? `${ref} passed the spot check.` : `${ref} sent back.`);
      }
      case "assign": {
        const to = picked("person")[0];
        const name = people?.find((p) => p.id === to)?.name ?? "them";
        const fn =
          t.kind === "service"
            ? async () => {
                const r = await assignServiceTickets([id], to);
                return r.ok && r.data.failed.length ? { ok: false as const, error: r.data.failed[0].error } : r;
              }
            : t.kind === "complaint"
              ? () => assignComplaint(id, to)
              : async () => {
                  const r = await assignTickets([id], to);
                  return r.ok && r.data.failed.length ? { ok: false as const, error: r.data.failed[0].error } : r;
                };
        return run(async () => {
          const r = await fn();
          if (r.ok) done();
          return r;
        }, `${ref} handed to ${name}.`);
      }
      default:
        return undefined;
    }
  }

  function send(body: string) {
    const text = body.trim();
    if (!text) return;
    const visibility = mode === "reply" ? "reporter" : "internal";
    run(async () => {
      const r = await addNote(t.id, text, visibility);
      if (r.ok) setDraft(null);
      return r;
    }, mode === "reply" ? `Sent to ${t.is_anonymous ? "the raiser" : t.reporter_name ?? "the raiser"}.` : "Note saved for your team.");
  }

  const typeBox = (key: string) =>
    typed === null ? (
      <button type="button" className="self-start text-xs font-medium text-primary hover:underline" onClick={() => setTyped("")}>
        Type instead
      </button>
    ) : (
      <Textarea
        rows={2}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        aria-label={`Your own words — ${key}`}
        autoFocus
      />
    );

  const panelBody = (() => {
    switch (panel) {
      case "fix":
        return (
          <Panel
            title="Mark fixed"
            onClose={close}
            why={`${t.reporter_name ?? "The raiser"} is asked: “Is it working now?”`}
            confirm="Mark fixed"
            canConfirm={!!photo && !!words("did")}
            onConfirm={confirmPanel}
            busy={isPending}
          >
            <Label required>Photo of the fixed thing</Label>
            <PhotoCapture value={photo} onChange={setPhoto} takeLabel="Take photo" />
            <Label required>What did you do?</Label>
            <Chips>
              {FIX_DONE.map((v) => (
                <Chip key={v} pressed={picked("did").includes(v)} onClick={() => toggle("did", v, true)}>
                  {v}
                </Chip>
              ))}
            </Chips>
            {typeBox("what you did")}
          </Panel>
        );
      case "resolve":
        return (
          <Panel
            title="Resolve"
            onClose={close}
            why={`The clock stops. ${t.reporter_name ?? "The requester"} is asked: “Is it solved?”`}
            confirm="Resolve"
            canConfirm={picked("cause").length > 0 && (picked("fix").length > 0 || (typed?.trim().length ?? 0) >= 10)}
            onConfirm={confirmPanel}
            busy={isPending}
          >
            <Label required>What caused it?</Label>
            <Chips>
              {IT_CAUSE.map((v) => (
                <Chip key={v} pressed={picked("cause").includes(v)} onClick={() => toggle("cause", v, true)}>
                  {v}
                </Chip>
              ))}
            </Chips>
            <Label required>What fixed it?</Label>
            <Chips>
              {IT_FIX.map((v) => (
                <Chip key={v} pressed={picked("fix").includes(v)} onClick={() => toggle("fix", v, true)}>
                  {v}
                </Chip>
              ))}
            </Chips>
            {typeBox("the fix")}
          </Panel>
        );
      case "answer":
        return (
          <Panel
            title="Answer"
            onClose={close}
            why={t.is_anonymous ? "Read on their tracking link. Their name stays hidden." : "The raiser reads this answer."}
            confirm="Send answer"
            canConfirm={words("answer").length >= 3}
            onConfirm={confirmPanel}
            busy={isPending}
          >
            <Label required>Pick the answer</Label>
            <Chips>
              {CONCERN_ANSWERS.map((v) => (
                <Chip key={v} pressed={picked("answer").includes(v)} onClick={() => toggle("answer", v, false)}>
                  {v}
                </Chip>
              ))}
            </Chips>
            {typeBox("the answer")}
          </Panel>
        );
      case "give":
        return (
          <Panel
            title="Mark given"
            onClose={close}
            why={`${t.reporter_name ?? "The raiser"} is told it is ready.`}
            confirm="Mark given"
            canConfirm
            onConfirm={confirmPanel}
            busy={isPending}
          >
            <Chips>
              {GIVE_NOTES.map((v) => (
                <Chip key={v} pressed={picked("give").includes(v)} onClick={() => toggle("give", v, false)}>
                  {v}
                </Chip>
              ))}
            </Chips>
          </Panel>
        );
      case "reject":
      case "hold":
      case "cancel": {
        const list =
          panel === "reject"
            ? REJECT_REASONS
            : panel === "cancel"
              ? CANCEL_REASONS
              : HOLD_REASONS[t.kind === "service" ? "it" : "fix"];
        const title = panel === "reject" ? "Reject" : panel === "cancel" ? "Cancel" : t.kind === "service" ? "Put on hold" : "Mark blocked";
        const why =
          panel === "hold"
            ? `The clock pauses. ${t.reporter_name ?? "The raiser"} sees why.`
            : `${t.reporter_name ?? "The raiser"} sees this reason.`;
        return (
          <Panel
            title={title}
            onClose={close}
            why={why}
            confirm={panel === "hold" ? "Pause" : title}
            canConfirm={words("reason").length >= 3}
            onConfirm={confirmPanel}
            busy={isPending}
          >
            <Label required>Why?</Label>
            <Chips>
              {list.map((v) => (
                <Chip key={v} pressed={picked("reason").includes(v)} onClick={() => toggle("reason", v, false)}>
                  {v}
                </Chip>
              ))}
            </Chips>
            {typeBox("the reason")}
          </Panel>
        );
      }
      case "spot":
        return (
          <Panel
            title="Spot-check"
            onClose={close}
            why="A failed check sends it back to the fixer."
            confirm="Save check"
            canConfirm={picked("spot").length > 0}
            onConfirm={confirmPanel}
            busy={isPending}
          >
            <Chips>
              {SPOT_NOTES.map((v) => (
                <Chip key={v} pressed={picked("spot").includes(v)} onClick={() => toggle("spot", v, false)}>
                  {v}
                </Chip>
              ))}
            </Chips>
          </Panel>
        );
      case "assign":
        return (
          <Panel
            title="Hand to"
            onClose={close}
            why="They are told at once."
            confirm="Hand over"
            canConfirm={picked("person").length > 0}
            onConfirm={confirmPanel}
            busy={isPending}
          >
            {people === null ? (
              <p className="text-xs text-muted-foreground">Loading people…</p>
            ) : people.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody else can take this here.</p>
            ) : (
              <Chips>
                {people.map((p) => (
                  <Chip key={p.id} pressed={picked("person").includes(p.id)} onClick={() => toggle("person", p.id, false)}>
                    {p.name}
                  </Chip>
                ))}
              </Chips>
            )}
          </Panel>
        );
      default:
        return null;
    }
  })();

  const quick = mode === "reply" ? QUICK_REPLY[lane] : QUICK_NOTE;
  const showCompose = canReply || canNote;
  const composeMode = !canReply ? "note" : !canNote ? "reply" : mode;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header detail={detail} onBack={onBack} onMore={onMore}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex-1" />
          {visibleSide && (
            <Button variant="outline" size="sm" onClick={() => open(visibleSide.panel as PanelKind)} disabled={isPending}>
              {visibleSide.label}
            </Button>
          )}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="w-8 px-0"
              aria-label="More actions"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
            {menu && (
              <div className="absolute right-0 top-9 z-20 flex min-w-44 flex-col rounded-lg border border-border bg-surface p-1 shadow-lg">
                {moreSide.map((b) => (
                  <Button key={b.action} variant="ghost" size="sm" className="justify-start" onClick={() => open(b.panel as PanelKind)}>
                    {b.label}
                  </Button>
                ))}
                {onMore ? (
                  <Button variant="ghost" size="sm" className="justify-start" onClick={() => {
                      setMenu(false);
                      onMore();
                    }}>
                    <Info aria-hidden="true" />
                    Details and other actions
                  </Button>
                ) : (
                  <Link
                    href={`/resolve/tickets/${t.id}`}
                    className="flex h-8 items-center gap-1.5 rounded-control px-3 text-xs hover:bg-surface-muted"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    Open full page
                  </Link>
                )}
              </div>
            )}
          </div>
          {primary && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => (primary.panel ? open(primary.panel) : oneTap(primary))}
            >
              {primary.label}
            </Button>
          )}
        </div>
        {panelBody}
      </Header>

      <TicketFeed detail={detail} meId={meId} />

      {showCompose && (
        <div className="flex flex-col gap-1.5 border-t border-border px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            {canReply && canNote && (
              <div className="flex flex-none rounded-control border border-border p-0.5" role="group" aria-label="Who sees it">
                {(["reply", "note"] as const).map((m) => (
                  // button-shape: exempt -- a two-word segment inside the composer row
                  <button
                    key={m}
                    type="button"
                    aria-pressed={composeMode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-xs font-semibold",
                      composeMode === m ? (m === "note" ? "bg-warning text-white" : "bg-foreground text-background") : "text-muted-foreground",
                    )}
                  >
                    {m === "reply" ? "Reply" : "Note"}
                  </button>
                ))}
              </div>
            )}
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {quick.map((q) => (
                <Chip key={q} tone={composeMode === "note" ? "note" : "plain"} onClick={() => send(q)} disabled={isPending}>
                  {q}
                </Chip>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-8 flex-none px-0"
              aria-label="Type a message"
              aria-pressed={draft !== null}
              onClick={() => setDraft((d) => (d === null ? "" : null))}
            >
              <Keyboard aria-hidden="true" />
            </Button>
          </div>
          {draft !== null && (
            <div className="flex items-end gap-1.5" data-focus-scope>
              <Textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={composeMode === "reply" ? "Reply" : "Team note"}
                className={cn("flex-1", composeMode === "note" && "bg-warning-soft")}
                autoFocus
              />
              <Button size="sm" onClick={() => send(draft)} disabled={isPending || !draft.trim()}>
                Send
              </Button>
            </div>
          )}
          <p className="flex justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Tap a chip to send it.</span>
            <span>
              {composeMode === "reply"
                ? t.is_anonymous
                  ? "The raiser reads replies on their tracking link"
                  : `${t.reporter_name ?? "The raiser"} sees replies`
                : "Notes: only your team"}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

// =====================================================================================
// RAISER
// =====================================================================================

export function RaiserPane({
  detail,
  meId,
  onBack,
  onChanged,
  onMore,
}: {
  detail: TicketDetail;
  meId: string;
  onBack: () => void;
  onChanged: () => void;
  onMore?: () => void;
}) {
  const t = detail.ticket;
  const { run, isPending } = useRun(onChanged);
  const [reopening, setReopening] = useState(false);
  const [saidYes, setSaidYes] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  useUnsavedGuard(isPending);

  const has = (a: TicketAction) => detail.actions.includes(a);
  const isIt = t.kind === "service";
  // Broken has no "confirm" step of its own: Yes leads to the stars, which
  // ARE the confirmation — so once rated, the question is not asked again.
  const canConfirm =
    (isIt && has("sd_confirm")) || (!isIt && t.status === "fixed" && !detail.myRating && (has("rate") || has("dispute")));
  const canReopen = isIt ? has("sd_reopen") : has("dispute");
  const canRate = has("rate") && !detail.myRating;
  const askConfirm = canConfirm && !saidYes;
  const withdrawAction = (["withdraw", "sd_withdraw", "c_withdraw", "rq_withdraw"] as const).find((a) => has(a));
  const lastWorker = [...detail.notes].reverse().find((n) => n.author_id && n.author_id !== t.reporter_id)?.author_name;

  function yes() {
    if (isIt) run(() => confirmServiceTicket(t.id), "Thanks — closed.");
    setSaidYes(true);
  }
  function reopen(reason: string) {
    run(
      () => (isIt ? reopenServiceTicket(t.id, reason) : disputeTicket(t.id, reason)),
      "Sent back to the team.",
    );
    setReopening(false);
  }
  function withdraw() {
    const fn =
      withdrawAction === "sd_withdraw"
        ? () => withdrawServiceTicket(t.id)
        : withdrawAction === "c_withdraw"
          ? () => withdrawComplaint(t.id)
          : withdrawAction === "rq_withdraw"
            ? () => withdrawRequirement(t.id)
            : () => withdrawTicket(t.id);
    run(fn, `${t.ref_no} withdrawn.`);
    setWithdrawing(false);
  }

  let ask: ReactNode;
  if (askConfirm) {
    ask = (
      <div className="flex flex-col gap-2.5 rounded-xl border border-primary bg-primary-soft p-3">
        <div>
          <p className="text-sm font-semibold">{isIt ? "Is it solved?" : "Is it working now?"}</p>
          <p className="text-xs text-muted-foreground">
            {lastWorker ?? "The team"} marked it {isIt ? "resolved" : "fixed"}. If you do not answer, it closes by itself.
          </p>
        </div>
        {reopening ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">What is wrong?</p>
            <div className="flex flex-wrap gap-1.5">
              {REOPEN_REASONS.map((r) => (
                <Chip key={r} onClick={() => reopen(r)} disabled={isPending}>
                  {r}
                </Chip>
              ))}
            </div>
            <button type="button" className="self-start text-xs font-medium text-primary hover:underline" onClick={() => setReopening(false)}>
              ← Back
            </button>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* button-shape: exempt -- a big two-way answer, sized for a thumb on the shop floor */}
            <button
              type="button"
              onClick={yes}
              disabled={isPending}
              className="h-12 rounded-xl bg-success-solid text-sm font-bold text-white hover:bg-success-solid-hover disabled:opacity-50"
            >
              Yes, {isIt ? "solved" : "working"}
            </button>
            {canReopen && (
              // button-shape: exempt -- the other half of the two-way answer above
              <button
                type="button"
                onClick={() => setReopening(true)}
                disabled={isPending}
                className="h-12 rounded-xl border border-danger bg-surface text-sm font-bold text-danger disabled:opacity-50"
              >
                No, still a problem
              </button>
            )}
          </div>
        )}
      </div>
    );
  } else if (canRate) {
    ask = (
      <div className="flex flex-col gap-2 rounded-xl border border-primary bg-primary-soft p-3">
        <p className="text-sm font-semibold">How was the help?</p>
        <div className="flex gap-1.5" role="group" aria-label="Rate the help">
          {[1, 2, 3, 4, 5].map((n) => (
            // button-shape: exempt -- one star of a five-star rating
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              disabled={isPending}
              onClick={() => run(() => rateTicket(t.id, n, null), "Thanks for rating.")}
              className="text-amber-400 transition-transform hover:scale-110 disabled:opacity-50"
            >
              <Star className="size-8 fill-current" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    );
  } else {
    const st = stepOf(t);
    const line = st.stopped
      ? st.stopped
      : st.held
        ? `On hold${t.blocked_reason ? `: ${t.blocked_reason}` : ""}. The clock is paused.`
        : t.assignee_name
          ? `${t.assignee_name} is on it.`
          : ["closed", "resolved", "fulfilled", "fixed"].includes(t.status)
            ? "Finished. Thank you."
            : "Waiting for someone to take it.";
    ask = (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold">{line}</p>
          {detail.myRating && <p className="text-xs text-muted-foreground">You rated it {"★".repeat(detail.myRating.stars)}</p>}
          {!detail.myRating && !st.stopped && t.status !== "closed" && (
            <p className="text-xs text-muted-foreground">Nothing needed from you.</p>
          )}
        </div>
        {withdrawAction &&
          (withdrawing ? (
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setWithdrawing(false)}>
                Keep it
              </Button>
              <Button variant="danger" size="sm" onClick={withdraw} disabled={isPending}>
                Withdraw
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)}>
              Withdraw
            </Button>
          ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header detail={detail} onBack={onBack} onMore={onMore}>
        {ask}
      </Header>
      <TicketFeed detail={detail} meId={meId} />
      {has("note_reporter") && (
        <div className="flex flex-col gap-1 border-t border-border px-2.5 py-2">
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {RAISER_QUICK.map((q) => (
              <Chip
                key={q}
                disabled={isPending}
                onClick={() => run(() => addNote(t.id, q, "reporter"), `Sent to ${t.team_name ?? "the team"}.`)}
              >
                {q}
              </Chip>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Tap to send. {t.team_name ?? "The team"} sees it.</p>
        </div>
      )}
    </div>
  );
}
