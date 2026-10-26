"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, Mail, MessageCircle, MessageSquareText, PencilLine, Phone, PhoneCall, TriangleAlert } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { ROUTE_LOOK, softLabel } from "@/components/resolve/chat/assist";
import { assistIcon } from "@/components/resolve/chat/assist-icons";
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
import { cn } from "@/lib/utils";
import { deskTicketHref, priorityTone } from "./desk-columns";

/** The caller's three words — never a priority (plan §1.3). Short, so all
 *  three sit on one line of a phone. */
const IMPACT_OPTIONS: { value: Impact; label: string }[] = [
  { value: "cannot_work", label: "Can't work" },
  { value: "degraded", label: "Slows them" },
  { value: "request", label: "Just asking" },
];

const CHANNEL_ICON: Record<DeskChannel, typeof Phone> = {
  phone: Phone,
  email: Mail,
  chat: MessageCircle,
  whatsapp: MessageSquareText,
};

/** "Something else" in the Which-one grid — the agent types the subject. */
const OTHER = "__other__";

type Person = { id: string; name: string };

/** One IT item of the Raagam Assist catalog, with the desk category it routes
 *  to (`rh_catalog_items.sd_category_code`, "HW" when unset — the same
 *  fallback `rh_assist_service` uses). */
export type LogCallItem = { id: string; label: string; dangerous: boolean; category_code: string };
export type LogCallArea = {
  id: string;
  label: string;
  icon: string;
  items: LogCallItem[];
  /** Where "Something else" in this area routes: its items' commonest code. */
  other_code: string;
};

/** What the receipt reads back: the server's answer plus the two names the
 *  agent picked, so "for whom, by what channel" sits beside the reference. */
type Logged = ServiceReceipt & { caller: string; channel: DeskChannel };

const IT = ROUTE_LOOK.it;

/**
 * Service Desk ▸ Log a Call (plan §6, spec §2). The agent raises a request ON
 * BEHALF of a caller — and since the 2026-10-26 mobile redesign it is asked the
 * way Report a Problem asks: TAP FIRST. Who is calling, how they came in, then
 * the IT areas of the Raagam Assist catalog and that area's choices, then how
 * much it stops them. A note is optional; the subject is the tapped choice.
 *
 * The picked catalog item maps onto the unchanged `logCall` FormData: its
 * `sd_category_code` resolves to one of this unit's open categories, its label
 * is the title, and the note (or "AREA: ITEM") is the description. When the
 * catalog is empty, or names a category this unit has not switched on, the
 * category picker of the old form appears instead, so a call can always be
 * logged.
 *
 * The choice grids are REAL RADIOS dressed as the chat's answer pills — Tab
 * lands on them and the arrows move within a grid, so the keyboard contract
 * holds without a line of keyboard code.
 *
 * It STAYS ON THIS PAGE after logging: the agent reads the receipt back while
 * still on the line, then takes the next call. A knowledge-base fix read out on
 * the phone ("That fixed it") ends the call with no ticket raised.
 */
export function LogCallScreen({
  categories,
  people,
  areas,
}: {
  categories: OpenServiceCategory[];
  people: Person[];
  areas: LogCallArea[];
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [requesterId, setRequesterId] = useState("");
  const [channel, setChannel] = useState<DeskChannel>("phone");
  const [areaId, setAreaId] = useState("");
  const [itemId, setItemId] = useState("");
  const [custom, setCustom] = useState("");
  const [pickedCategoryId, setPickedCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [impact, setImpact] = useState<Impact | "">("");
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [logged, setLogged] = useState<Logged | null>(null);
  const [solved, setSolved] = useState<KbSearchHit | null>(null);

  const dirty =
    !logged &&
    (requesterId !== "" ||
      areaId !== "" ||
      custom.trim() !== "" ||
      pickedCategoryId !== "" ||
      note.trim() !== "" ||
      impact !== "");
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

  // Plain consts — a cheap pass over a handful of rows needs no memo.
  const catalog = areas.length > 0;
  const area = areas.find((a) => a.id === areaId) ?? null;
  const item = area?.items.find((i) => i.id === itemId) ?? null;
  const isOther = itemId === OTHER || !catalog;
  const chose = !catalog || itemId !== "";
  const code = item ? item.category_code : area && itemId === OTHER ? area.other_code : null;
  const routed = code ? (categories.find((c) => c.code === code) ?? null) : null;
  // The picker shows when there is no catalog, or the choice routes to a
  // category this unit has not switched on.
  const askCategory = !catalog || (chose && !routed);
  const category = askCategory ? (categories.find((c) => c.id === pickedCategoryId) ?? null) : routed;
  const title = (item ? item.label : custom).trim();
  const description = note.trim() || (area ? `${area.label}: ${title}` : title);

  const missing = {
    requester: !requesterId,
    area: catalog && !area,
    item: catalog && !!area && itemId === "",
    title: chose && isOther && !custom.trim(),
    category: chose && !category,
    description: description.length < 3,
    impact: impact === "",
  };

  function reset() {
    setRequesterId("");
    setChannel("phone");
    setAreaId("");
    setItemId("");
    setCustom("");
    setPickedCategoryId("");
    setNote("");
    setImpact("");
    setAttempted(false);
    setServerError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    if (Object.values(missing).some(Boolean) || !category) return;
    const fd = new FormData();
    fd.set("requester_id", requesterId);
    fd.set("source", channel);
    fd.set("category_id", category.id);
    fd.set("title", title);
    fd.set("description", description);
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
    <div className="w-full max-w-[40rem]">
      {logged ? (
        <Receipt r={logged} onNext={() => setLogged(null)} />
      ) : solved ? (
        <div role="status" className="space-y-3 rounded-xl border border-success/40 bg-success-soft/50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            Solved on the call — no request was raised.
          </p>
          <p className="text-sm text-muted-foreground">&ldquo;{solved.title}&rdquo; is counted as having helped.</p>
          <Button
            type="button"
            className="w-full sm:w-auto"
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
          <Field
            label="Who is calling?"
            required
            className="w-full"
            error={attempted && missing.requester ? "Pick who is calling." : undefined}
          >
            <Combobox options={peopleOptions} value={requesterId} onChange={setRequesterId} />
          </Field>

          <Field label="Came in by" className="w-full">
            <ToggleGroup<DeskChannel>
              label="Came in by"
              value={channel}
              onChange={setChannel}
              className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={DESK_CHANNELS.map((c) => ({ value: c, label: SOURCE_LABEL[c], icon: CHANNEL_ICON[c] }))}
            />
          </Field>

          {catalog ? (
            <Field
              label="What is it about?"
              required
              className="w-full"
              error={attempted && missing.area ? "Pick what the problem is about." : undefined}
            >
              <PickGrid
                name="sd-log-call-area"
                value={areaId}
                onChange={(v) => {
                  setAreaId(v);
                  setItemId("");
                  setCustom("");
                  setPickedCategoryId("");
                }}
                options={areas.map((a) => ({ value: a.id, label: a.label, icon: assistIcon(a.icon) }))}
              />
            </Field>
          ) : null}

          {area ? (
            <Field
              label="Which one?"
              required
              className="w-full"
              error={attempted && missing.item ? "Pick the closest one, or Something else." : undefined}
            >
              <PickGrid
                name="sd-log-call-item"
                value={itemId}
                onChange={(v) => {
                  setItemId(v);
                  setPickedCategoryId("");
                }}
                options={[
                  ...area.items.map((i) => ({ value: i.id, label: softLabel(i.label), danger: i.dangerous })),
                  { value: OTHER, label: "Something else", icon: PencilLine },
                ]}
              />
            </Field>
          ) : null}

          {chose && isOther ? (
            <Field
              label="In a few words"
              required
              className="w-full"
              error={attempted && missing.title ? "Say in a few words what is wrong or what they need." : undefined}
            >
              <Input value={custom} maxLength={120} onChange={(e) => setCustom(e.target.value)} />
            </Field>
          ) : null}

          {chose && askCategory ? (
            <Field
              label="Desk category"
              required
              className="w-full"
              hint={
                catalog
                  ? "This choice routes to a category not switched on in this unit — pick the nearest."
                  : (category?.description ?? undefined)
              }
              error={attempted && missing.category ? "Pick what the problem is about." : undefined}
            >
              <Combobox options={categoryOptions} value={pickedCategoryId} onChange={setPickedCategoryId} />
            </Field>
          ) : null}

          {chose ? (
            <KbSuggestions
              query={title}
              categoryCode={category?.code ?? null}
              disabled={isPending}
              onSolved={(hit) => {
                reset();
                setSolved(hit);
              }}
            />
          ) : null}

          <Field
            label="How much does it stop them?"
            required
            className="w-full"
            error={attempted && missing.impact ? "Ask how much this stops them working." : undefined}
          >
            <Segmented<Impact | "">
              name="sd-log-call-impact"
              value={impact}
              onChange={setImpact}
              options={IMPACT_OPTIONS}
              disabled={isPending}
              className="w-full [&>label]:flex-1 [&>label]:justify-center"
            />
          </Field>

          <Field
            label="Note (optional)"
            className="w-full"
            error={attempted && missing.description ? "Say what happened, or what they need." : undefined}
          >
            <Textarea value={note} maxLength={4000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {serverError ? <FieldError>{serverError}</FieldError> : null}

          {/* DOCKED ON A PHONE, above the bottom tab bar — the same offset the
              Raagam Assist answer bar uses — so the one action is always under
              the thumb. From md up it is the form's ordinary footer. */}
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-3 border-t border-border bg-surface px-3 py-2.5 md:static md:mx-0 md:flex md:justify-end md:px-0 md:pb-0 md:pt-3">
            <Button type="submit" disabled={isPending} className="w-full md:w-auto">
              <PhoneCall className="h-4 w-4" aria-hidden />
              {isPending ? "Logging…" : "Log the call"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * The chat's answer pill, as a RADIO. Same face as `AnswerPill` (rounded-xl,
 * a small tinted icon tile, lifts under the finger), two per row on a phone,
 * and the picked one lit in the IT lane's colour. Being radios, Tab lands on
 * the group and ↑↓←→ move the pick — `lib/focus.ts` already owns radios.
 */
function PickGrid({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: typeof Phone; danger?: boolean }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {options.map((o) => {
        const Glyph = o.danger ? TriangleAlert : o.icon;
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface py-1.5 pr-2.5 text-left text-[13px] font-medium leading-4 shadow-sm",
              "transition duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.97]",
              "has-focus-visible:outline-2 has-focus-visible:outline-ring",
              "has-checked:border-sky-500 has-checked:bg-sky-50 has-checked:ring-1 has-checked:ring-sky-500 dark:has-checked:bg-sky-400/10",
              Glyph ? "pl-1.5" : "pl-3",
              o.danger ? "border-red-200 hover:border-red-400 dark:border-red-500/30" : IT.ring,
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {Glyph && (
              <span
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-lg",
                  o.danger ? "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300" : IT.tile,
                )}
                aria-hidden="true"
              >
                <Glyph className="size-3.5" />
              </span>
            )}
            <span className="min-w-0">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** What the agent reads back to the caller — the reference first, big, then
 *  the two lines they say after it. */
function Receipt({ r, onNext }: { r: Logged; onNext: () => void }) {
  return (
    <div role="status" className="space-y-3 rounded-xl border border-success/40 bg-success-soft/50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CircleCheck className="h-4 w-4 text-success" aria-hidden />
        Logged — read this back to {r.caller || "the caller"}
      </p>
      <p className="font-mono text-2xl font-semibold tracking-wide text-foreground">{r.ref_no}</p>
      <div className="space-y-1 text-sm text-foreground">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill tone={priorityTone(r.priority)}>{PRIORITY_LABEL[r.priority]}</StatusPill>
          <span>{r.team_name ?? "The desk will route it"}</span>
          <span className="text-muted-foreground">· {r.owner_name ?? "Not yet assigned"}</span>
          <span className="text-muted-foreground">· {SOURCE_LABEL[r.channel]}</span>
        </p>
        <p className="text-muted-foreground">
          First reply by {r.response_due_at ? fmtDateTime(r.response_due_at) : "—"} · Fixed by{" "}
          {r.due_at ? fmtDateTime(r.due_at) : "—"}
        </p>
      </div>
      {r.needs_sorting && (
        <p className="text-xs text-warning">No team covers this category yet — the desk manager will route it.</p>
      )}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
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
