"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, PhoneCall } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { KbSuggestions } from "@/components/resolve/kb/kb-suggestions";
import { fmtDateTime } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { logCall } from "@/lib/resolve/desk-actions";
import {
  DESK_CHANNELS,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  TICKET_TYPE_LABEL,
  type DeskChannel,
  type Impact,
  type KbSearchHit,
  type OpenServiceCategory,
  type ServiceReceipt,
} from "@/lib/resolve/desk-types";
import { deskTicketHref, priorityTone } from "./desk-columns";

/** The caller's three words — never a priority (plan §1.3). Same labels as
 *  the requester's own form, so a caller and a self-service user are asked
 *  the identical question. */
const IMPACT_OPTIONS: { value: Impact; label: string }[] = [
  { value: "cannot_work", label: "Cannot work" },
  { value: "degraded", label: "With difficulty" },
  { value: "request", label: "Just a request" },
];

type Person = { id: string; name: string };

/** What the receipt reads back: the server's answer plus the two names the
 *  agent typed, so "for whom, by what channel" sits beside the reference. */
type Logged = ServiceReceipt & { caller: string; channel: DeskChannel };

/**
 * Service Desk ▸ Log a Call (plan §6, spec §2). The agent raises a request ON
 * BEHALF of a caller: who is calling, how they reached the desk, then the same
 * questions the requester's own form asks. `logCall` needs resolve:edit and
 * skips the self-service rate limit (plan §1.8) — the database checks both.
 *
 * It STAYS ON THIS PAGE after logging, unlike the requester's form: the agent
 * reads the receipt back to the caller (reference, team, first reply by) while
 * still on the line, then takes the next call. The ticket is one link away.
 *
 * Knowledge-base suggestions show under the title as the agent types — a fix
 * read out on the phone ends the call with no ticket raised.
 *
 * No screenshot box: a call has nothing to attach, and a caller who has one is
 * pointed at IT Help Request, where the photo path already exists.
 */
export function LogCallScreen({ categories, people }: { categories: OpenServiceCategory[]; people: Person[] }) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [requesterId, setRequesterId] = useState("");
  const [channel, setChannel] = useState<DeskChannel>("phone");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState<Impact | "">("");
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [logged, setLogged] = useState<Logged | null>(null);
  const [solved, setSolved] = useState<KbSearchHit | null>(null);

  const dirty =
    !logged &&
    (requesterId !== "" || categoryId !== "" || title.trim() !== "" || description.trim() !== "" || impact !== "");
  useUnsavedGuard(dirty || isPending);

  const peopleOptions = useMemo<ComboboxOption[]>(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);
  const categoryOptions = useMemo<ComboboxOption[]>(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: TICKET_TYPE_LABEL[c.ticket_type],
        search: c.code,
      })),
    [categories],
  );
  const category = categories.find((c) => c.id === categoryId) ?? null;

  const missing = {
    requester: !requesterId,
    category: !categoryId,
    title: !title.trim(),
    description: description.trim().length < 3,
    impact: impact === "",
  };

  function reset() {
    setRequesterId("");
    setChannel("phone");
    setCategoryId("");
    setTitle("");
    setDescription("");
    setImpact("");
    setAttempted(false);
    setServerError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    if (Object.values(missing).some(Boolean)) return;
    const fd = new FormData();
    fd.set("requester_id", requesterId);
    fd.set("source", channel);
    fd.set("category_id", categoryId);
    fd.set("title", title.trim());
    fd.set("description", description.trim());
    fd.set("impact", impact);
    const caller = people.find((p) => p.id === requesterId)?.name ?? "";
    startTransition(async () => {
      const res = await logCall(fd);
      if (!res.ok) {
        setServerError(res.error);
        toastError(res.error);
        return;
      }
      success(`Logged ${res.data.ref_no}.`);
      setLogged({ ...res.data, caller, channel });
      reset();
    });
  }

  // ONE return, branching inside it — every hook sits above this line
  // (AGENTS "Hooks above every early return").
  return (
    <div className="w-full max-w-[37rem]">
      {logged ? (
        <Receipt r={logged} onNext={() => setLogged(null)} />
      ) : solved ? (
        <div role="status" className="space-y-3 rounded-lg border border-success/40 bg-success-soft/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            Solved on the call — no request was raised.
          </p>
          <p className="text-sm text-muted-foreground">&ldquo;{solved.title}&rdquo; is counted as having helped.</p>
          <Button
            type="button"
            onClick={() => {
              setSolved(null);
              reset();
            }}
          >
            Take the next call
          </Button>
        </div>
      ) : (
        <form
          onSubmit={submit}
          // ONE MARKER, NEVER A HANDLER — a page form joins the Tab/Enter contract.
          data-focus-scope
          className="space-y-4"
        >
          {/* 37rem: two 288px name steps + the 12px gap = 588px. */}
          <FieldRow align="start">
            <Field
              label="Caller"
              required
              w="name"
              error={attempted && missing.requester ? "Pick who is calling." : undefined}
            >
              <Combobox options={peopleOptions} value={requesterId} onChange={setRequesterId} />
            </Field>
            <Field label="Came In By" w="name">
              <Segmented<DeskChannel>
                name="sd-log-call-channel"
                value={channel}
                onChange={setChannel}
                options={DESK_CHANNELS.map((c) => ({ value: c, label: SOURCE_LABEL[c] }))}
              />
            </Field>
          </FieldRow>

          <FieldRow align="start">
            <Field
              label="What Is It About"
              required
              w="name"
              hint={category?.description ?? undefined}
              error={attempted && missing.category ? "Pick what the problem is about." : undefined}
            >
              <Combobox options={categoryOptions} value={categoryId} onChange={setCategoryId} />
            </Field>
          </FieldRow>

          <Field
            label="In A Few Words"
            required
            error={attempted && missing.title ? "Say in a few words what is wrong or what they need." : undefined}
          >
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <KbSuggestions
            query={title}
            categoryCode={category?.code ?? null}
            disabled={isPending}
            onSolved={(hit) => {
              reset();
              setSolved(hit);
            }}
          />

          <Field
            label="What Happened, Or What They Need"
            required
            error={attempted && missing.description ? "Say what happened, or what they need." : undefined}
          >
            <Textarea value={description} maxLength={4000} rows={4} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <Field
            label="How Much Does It Stop Them"
            required
            error={attempted && missing.impact ? "Ask how much this stops them working." : undefined}
          >
            <Segmented<Impact | "">
              name="sd-log-call-impact"
              value={impact}
              onChange={setImpact}
              options={IMPACT_OPTIONS}
              disabled={isPending}
            />
          </Field>

          {serverError ? <FieldError>{serverError}</FieldError> : null}

          <div className="flex justify-end border-t border-border pt-3">
            <Button type="submit" disabled={isPending}>
              <PhoneCall className="h-4 w-4" aria-hidden />
              {isPending ? "Logging…" : "Log the call"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** What the agent reads back to the caller, in the order they say it. */
function Receipt({ r, onNext }: { r: Logged; onNext: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ["For", `${r.caller} · ${SOURCE_LABEL[r.channel]}`],
    ["Team", r.team_name ?? "The desk will route it"],
    ["With", r.owner_name ?? "Not yet assigned"],
    ["Priority", <StatusPill key="p" tone={priorityTone(r.priority)}>{PRIORITY_LABEL[r.priority]}</StatusPill>],
    ["First reply by", r.response_due_at ? fmtDateTime(r.response_due_at) : "—"],
    ["Resolve by", r.due_at ? fmtDateTime(r.due_at) : "—"],
  ];
  return (
    <div role="status" className="space-y-4 rounded-lg border border-success/40 bg-success-soft/50 p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CircleCheck className="h-4 w-4 text-success" aria-hidden />
          Logged — read this reference back to the caller
        </p>
        <p className="font-mono text-2xl font-semibold tracking-wide text-foreground">{r.ref_no}</p>
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {r.needs_sorting && (
        <p className="text-xs text-warning">No team covers this category yet — the desk manager will route it.</p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Link href={deskTicketHref(r.ticket_id)} className={buttonClasses({ variant: "outline" })}>
          Open the ticket
        </Link>
        <Button type="button" onClick={onNext}>
          Log another call
        </Button>
      </div>
    </div>
  );
}
