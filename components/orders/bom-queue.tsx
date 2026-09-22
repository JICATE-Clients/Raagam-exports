"use client";

import { useMemo, useState } from "react";
import { Check, Clock, Pencil } from "lucide-react";
import { today as todayAtFactory } from "@/lib/calendar";
import type { StatusTone } from "@/lib/ui/tone";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { createdMeta, creatorName, hasCreatedInfo } from "@/components/ui/created-columns";
import {
  BomFilterDrawer,
  NO_FACETS,
  type BomFilterValues,
  type QueueFacets,
  type Urgency,
} from "@/components/orders/bom-filter-drawer";
import { matchesCreatedDate } from "@/lib/date-filter";
import {
  BOM_STATUSES,
  BOM_STATUS_RANK,
  bomStatusText,
  bomStatusTone,
  type BomStatus,
} from "@/lib/orders/bom-status";
import type { BomTaskRow } from "@/lib/orders/bom-order-basis";

/**
 * THE WORK QUEUE EVERY BOM SCREEN OPENS ON — one declaration, two readers.
 *
 * Material BOM and Fabric BOM are the same question asked about two different
 * documents: "which confirmed orders still need planning?". They already share
 * the row (`BomTaskRow`), the status vocabulary, the freshness pairing and the
 * sort — all `bom-order-basis.ts`'s, deliberately, so the two cannot come to
 * disagree about what "Recalculate" means. What they did NOT share was the way
 * that answer is DRAWN, and so they drifted: Material BOM's queue became a
 * six-across card grid with a counted Status facet and a summary sentence
 * (client 2026-08-17 · 08-19 · 08-21), while Fabric BOM stayed the `DataTable`
 * both started as (client screenshot 2590, 2026-09-01: "this screen also like
 * the material bom listing … not like this list").
 *
 * SO THE FIX IS THE COMPONENT, NOT THE SCREEN. AGENTS.md's repeated lesson is
 * that the fan-out is always on the hand-rolled half — a per-screen answer to a
 * shared rule always leaves a remainder, and here the remainder was every BOM
 * screen that was not the one being worked on that week. Everything below
 * arrived as an instruction about Material BOM's queue and is now true of both,
 * and of the third BOM queue when it is written.
 *
 * WHAT STAYS AT THE CALL SITE is what genuinely differs: the `PageHeader` (the
 * screen's own title, description and "+ New" button), what opening a row does,
 * what deleting one does, and the ONE figure in the middle of a card. Everything
 * else — the search, the counted facet, the summary, the card, the Created pair
 * — is here.
 */

/**
 * "· 12d" beside a delivery date, and "· 12d late" when it has passed.
 *
 * THE DATE SAYS WHEN AND THE SUFFIX SAYS HOW SOON, which are different
 * questions: a merchandiser scanning a queue is deciding what to plan THIS
 * WEEK, and arithmetic against thirty dates is what they were doing by eye.
 *
 * SILENT BEYOND 60 DAYS. A "· 109d" on an order shipping in December is noise
 * on every card, and noise on every card is what stops the two that say "· 4d"
 * from being seen. Late is never silent and is the only one that takes a
 * colour.
 *
 * NO HYDRATION GUARD IS NEEDED, and that is `todayAtFactory`'s doing rather
 * than luck. It formats in Asia/Kolkata, so the server (UTC) and the operator's
 * browser (IST) agree on what day it is — including during the 5.5 hours every
 * morning when `new Date()` does not. Do not reach for the UTC `today()` that
 * `lib/dashboard/range.ts` exports here.
 */
export function DaysOut({ iso }: { iso: string }) {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${todayAtFactory()}T00:00:00`);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  const days = Math.round((at - now) / 86_400_000);

  if (days < 0) {
    return <span className="font-normal text-danger"> · {-days}d late</span>;
  }
  if (days === 0) return <span className="font-normal text-danger"> · today</span>;
  if (days > 60) return null;
  return <span className="font-normal text-muted-foreground"> · {days}d</span>;
}

/**
 * THE THREE FIGURES A QUEUE CARD CARRIES, and the order of them is the point.
 *
 * It was Styles · Production · Delivery at one weight, so nothing was
 * emphasised and nothing was scannable (client 2026-08-21, screenshot 2440). A
 * BOM multiplies the production quantity — it is the number the document is FOR
 * — and a merchandiser going down the queue is going down the quantities.
 * Delivery is the urgency and holds the right edge, where dates line up down
 * the grid; the count in the middle is the least of the three and no longer
 * leads.
 *
 * A REFUSAL STILL PRINTS ITS SENTENCE, never a dash and never 0 — "no
 * production quantity yet" and "nothing entered" look identical as a dash and
 * only one of them is actionable. `CardStat.value` is a node for this reason;
 * the strip truncates it and reveals it on hover, so an unanswerable card
 * cannot set the height of its whole row. A missing delivery date IS still a
 * dash: "the system tried and cannot answer" and "nobody has entered one" are
 * different facts, and only the first is a sentence.
 *
 * THE MIDDLE FIGURE IS THE CALLER'S, because it is the one thing about this
 * card that is genuinely about WHICH BOM this is. Material BOM counts the
 * order's styles; Fabric BOM counts the fabric lines already planned, which is
 * what its table showed and what an operator picking up a half-done BOM looks
 * for. Both come off the same `BomTaskRow`, so neither costs a query.
 */
export function bomCardStats(t: BomTaskRow, middle: CardStat): CardStat[] {
  return [
    {
      label: "Production",
      value:
        t.production_qty != null
          ? fmtNumber(t.production_qty)
          : (t.production_refusal ?? "—"),
    },
    middle,
    {
      label: "Delivery",
      value: t.delivery_date ? (
        <>
          {fmtDate(t.delivery_date)}
          <DaysOut iso={t.delivery_date} />
        </>
      ) : (
        "—"
      ),
    },
  ];
}

/**
 * THE QUEUE'S STATUS COLOUR — `bomStatusTone`, with Pending taken to RED
 * (operator, 2026-09-18, from the reference screenshot: "Pending status, show a
 * red warning indicator on the side; Completed, green"). Completed is the
 * `updated` state — the plan matches the order — and is already `success`.
 *
 * LOCAL TO THE QUEUE ON PURPOSE. `bomStatusTone` keeps Pending amber for every
 * other reader (the garment order's status pills among them); here the queue
 * is a to-do list, where an order with no plan at all IS the work, so it takes
 * the act-on-it colour Recalculate and Unresolved already carry. The pill and
 * the stripe both read this one function, so on a card they can never
 * disagree.
 */
function queueTone(s: BomStatus): StatusTone {
  return s === "pending" ? "danger" : bomStatusTone(s);
}

/**
 * THE EXACT SHADES FOR THE TWO STATES THE QUEUE IS READ BY (operator,
 * 2026-09-18): Pending a prominent DARK RED, Updated — the completed state —
 * a clean GREEN. Palette classes rather than the skin's `danger` / `success`
 * tokens because the ask named the shades; the other three states keep their
 * tone, which is why this is a lookup that can miss and not a full table.
 *
 * `border` + `py-px` IS ONE MOVE: the pill's own `py-0.5` plus a 1px border
 * would make these two pills 2px taller than a Draft or Recalculate pill in the
 * same grid, and the header rows would stop lining up.
 *
 * `dark:` ON EVERY SHADE — this app has a dark theme (the `.dark` class from
 * the topbar toggle), and a `bg-red-50` pill there is a glaring light patch.
 */
const QUEUE_THEME: Partial<Record<BomStatus, { pill: string; edge: string }>> = {
  pending: {
    pill: "border border-red-200 bg-red-50 py-px text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
    edge: "border-l-red-700 dark:border-l-red-500",
  },
  updated: {
    pill: "border border-emerald-200 bg-emerald-50 py-px text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
    edge: "border-l-emerald-500",
  },
};

/** The queue's status pill — exported so a caller's own surface (Fabric BOM's
 *  preview drawer) paints the same shade the card beside it does. */
export function BomQueuePill({ status }: { status: BomStatus }) {
  return (
    <StatusPill tone={queueTone(status)} className={QUEUE_THEME[status]?.pill}>
      {bomStatusText(status)}
    </StatusPill>
  );
}

/**
 * PENDING / UPDATED, FIRST ON THE SEARCH ROW (user, 2026-09-21: "1st pending
 * update and search box filter this order") — before the search box and the
 * Filters button, not after them.
 *
 * THIS REVERSES PART OF 2026-08-21, deliberately. The note on the Filters
 * panel below records the client rejecting a rail of chips for the counts in
 * the panel's Status facet. That facet stays — it is still the only way to
 * reach Draft and Recalculate, and it still carries the counts. This is a
 * shortcut to the two ends of the queue with its OWN state (`quickFilter`), not
 * connected to the Filters panel — see the note where that state is declared.
 *
 * `bg-slate-100` as asked, with a token fallback in dark mode, where slate-100
 * would be a white bar. `h-9`, the height of the search box and Filters button
 * beside it (LAYOUT.md §10).
 *
 * ONE BOX (user, 2026-09-21: "pending and update one box convert this box is
 * toogle type") — Pending on the left, Updated on the right. The switch that
 * stood between them came out the same day ("remove toggle icon"): the two
 * box is now ONE button holding both words ("The Update and Pending should be
 * in the same box"): a click anywhere flips between them, the current one
 * standing out as a white pill inside the box.
 * No "All" and no Reset link on this row ("all and reset remove"); the
 * Filters panel's Status facet still reaches All, Draft and Recalculate.
 *
 * THE QUEUE OPENS ON PENDING (user 2026-09-22: "material bom, fabric bom,
 * approval, budgeting — intha tab la lam pending status la default aa open
 * la irukkanum"). It opened unfiltered, neither word lit, until then. Pending
 * is the work still to do, which is what an operator opening a work queue is
 * there for; Updated and Draft are one click away, and the box below steps
 * from unfiltered to Pending first for the same reason. Budget Approval
 * already opened on Pending; this makes the other three agree with it.
 */
type QuickWord = "pending" | "updated" | "draft";
/**
 * ICON + WORD, THE CHOSEN ONE IN THE THEME'S COLOUR (user 2026-09-22, option
 * H of the eight mocked up that morning — "4th one apply" — and then, the
 * same afternoon, screenshot 144250 of the topbar "T" menu's COLOUR list:
 * "intha colour theme-kkum set aagara maari pending / updated / draft field
 * colour kondu va"). Clock / tick / pencil say what each state means without
 * reading. The lit word is `bg-primary text-primary-foreground` — the pair
 * the primary Button wears, read from the two tokens every colour preset
 * overrides (`lib/appearance.ts`: `--primary`, `--primary-soft`), so under
 * Navy, Ocean, Teal or Graphite the box is that colour, and its contrast is
 * the preset's own, already proven by `check:themes`.
 *
 * THE PER-STATE TONE (Pending danger / Updated success / Draft warning) WAS
 * THE MORNING'S ANSWER AND IS SUPERSEDED. It matched the cards' status pill,
 * which was a real argument; the later instruction is that the box follows
 * the theme, which a red/green/amber word cannot. The pill on the cards keeps
 * its tones — that is the card saying what state IT is in — and the box says
 * only which word is chosen.
 *
 * THE BOX IS PLAIN; ONLY THE CHOSEN WORD IS THE THEME COLOUR (user
 * 2026-09-22, settled on the fourth ask of the hour: "background-ku colour
 * vendaam, button colour mattum change aaganum, namba enna theme select
 * pandromo athukku set aagara maari"). The two cuts before it are worth
 * one line each so neither comes back: the box on `--primary-soft` (a 4%
 * tint that reads as white, so the theme switch looked like it did nothing)
 * and then the whole box in `bg-primary` with a white pill (which the user
 * read as "background colour", and did not want). So: `bg-surface` and the
 * ordinary `border-border`, exactly the box every other control in the
 * header row sits in, and the chosen word is the Button's own pair —
 * `bg-primary text-primary-foreground` — which is what follows the preset.
 */
const QUICK: Record<QuickWord, { text: string; icon: typeof Clock }> = {
  pending: { text: "Pending", icon: Clock },
  updated: { text: "Updated", icon: Check },
  draft: { text: "Draft", icon: Pencil },
};
/* THE PRIMARY BUTTON'S OWN MARKERS, NOT JUST ITS TOKENS (user 2026-09-22,
   screenshot 145813 under Steel: "steel colour set aagi appo pending update
   draft um steel colour la button change aaganum"). `bg-primary` alone is the
   preset's flat colour; a GRADIENT preset (Steel, Raagam Gradient, …) paints
   its buttons through `.ty-btn-primary` (`gradientCss` in lib/appearance.ts),
   so a pill wearing only the token sat flat beside a "+ New Fabric BOM" that
   ran graphite → blue. With the marker it takes the same gradient, hover and
   pressed rules the Button does, under every preset, flat or not.

   `bg-(--primary)`, NOT `bg-primary` — THE ONE THING THAT ACTUALLY MADE IT
   FOLLOW THE THEME (user 2026-09-22, fourth and fifth asks: "teal theme
   change panna … teal colour la, navy select panna navy colour la"). Same
   CSS — `background-color: var(--primary)` — but a different CLASS NAME, and
   the class name is what mattered: the raagam skin paints every
   `button[class*="bg-primary"]` a FIXED light-blue gradient (globals.css,
   "THE RIGHT-HAND BUTTONS …", #cfe8f7 → #93c9e8), which is the #9ecfeb pill
   in screenshot 145813 under Steel, and would have been the same light blue
   under Navy and Teal. That rule is Save's look under the skin and stays;
   this pill is a filter, not a Save, and the ask is that it show the theme.
   A class the attribute selector cannot match is how it opts out — the
   `hover:` reads the hover token the same way for the same reason. */
const QUICK_LIT =
  "ty-btn-solid ty-btn-primary bg-(--primary) hover:bg-(--primary-hover) font-semibold text-primary-foreground shadow-sm";

export function StatusSegment({
  value,
  onChange,
  draft = false,
}: {
  /* A plain string, not `BomStatus`: the Budgets queue draws this same box
     over its own vocabulary (2026-09-21, "update and pending options … like
     fabric bom"), and only the words below are ever compared. */
  value: string;
  onChange: (v: QuickWord) => void;
  /** A THIRD WORD, DRAFT, AFTER UPDATED (user, 2026-09-22: "pending update
   *  pakkathala draft nu oru field add"), asked for on Material BOM first and
   *  then on Fabric BOM, Budgeting and Approval the same morning — so every
   *  caller passes it today. Kept opt-in so a future two-state queue can draw
   *  the box without a word that could only ever show an empty list. */
  draft?: boolean;
}) {
  const words: QuickWord[] = draft ? ["pending", "updated", "draft"] : ["pending", "updated"];
  const current = words.includes(value as QuickWord) ? (value as QuickWord) : null;
  const label = current ? QUICK[current].text : "all";
  return (
    /* ONE BOX, A BUTTON PER WORD. It used to be ONE button whose whole face
       flipped Pending ↔ Updated ("pending and update one box convert this box
       is toogle type"); a third word has no "other side" to flip to, so each
       word now picks itself. Clicking the lit word steps to the next one —
       which on the two-word box is exactly the flip it always was. From
       unfiltered, Pending is still the first landing. */
    <div
      role="group"
      aria-label={`Status: ${label}`}
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-xs font-medium"
    >
      {words.map((s, i) => {
        const Icon = QUICK[s].icon;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={value === s}
            onClick={() => onChange(value === s ? words[(i + 1) % words.length] : s)}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 transition-colors",
              value === s ? QUICK_LIT : "text-muted-foreground hover:bg-surface-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {QUICK[s].text}
          </button>
        );
      })}
    </div>
  );
}

/**
 * THE QUEUE'S EIGHT EXTRA FACETS (user, 2026-09-21: "add filter field from
 * Customer to Created By") — every one read off the `BomTaskRow` the card
 * already carries, so none costs a query.
 *
 * The facet SHAPE and the panel that edits it live in
 * `components/orders/bom-filter-drawer.tsx`; the MATCHING stays here.
 *
 * Delivery Urgency reads the same factory-day arithmetic as `DaysOut`, so the
 * "· 4d" on a card and the "Due within 7 days" it is filtered under cannot
 * disagree. Created By compares `creatorName`, which never returns a uuid — a
 * row whose creator is unknown matches only "All", never a blank option.
 */
function activeFacetCount(f: QueueFacets): number {
  return Object.values(f).filter(Boolean).length;
}

function distinctSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function daysToDelivery(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${todayAtFactory()}T00:00:00`);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  return Math.round((at - now) / 86_400_000);
}

function matchesUrgency(t: BomTaskRow, u: Urgency): boolean {
  if (!u) return true;
  const d = daysToDelivery(t.delivery_date);
  if (u === "none") return d == null;
  if (d == null) return false;
  if (u === "late") return d < 0;
  if (u === "week") return d >= 0 && d <= 7;
  if (u === "month") return d > 7 && d <= 30;
  return d > 30;
}

function matchesFacets(t: BomTaskRow, f: QueueFacets): boolean {
  if (f.customer && t.customer_name?.trim() !== f.customer) return false;
  if (f.delivery && !matchesCreatedDate(t.delivery_date, f.delivery)) return false;
  if (!matchesUrgency(t, f.urgency)) return false;
  if (f.orderDate && !matchesCreatedDate(t.amend_date, f.orderDate)) return false;
  if (f.qty === "known" && t.production_qty == null) return false;
  if (f.qty === "missing" && t.production_qty != null) return false;
  if (f.styles === "single" && t.style_count > 1) return false;
  if (f.styles === "multiple" && t.style_count <= 1) return false;
  if (f.started === "none" && t.bom_id) return false;
  if (f.started === "empty" && (!t.bom_id || t.bom_line_count > 0)) return false;
  if (f.started === "lines" && (!t.bom_id || t.bom_line_count === 0)) return false;
  if (f.createdBy && creatorName(t) !== f.createdBy) return false;
  return true;
}

export function BomQueue({
  tasks,
  noun,
  stat,
  onOpen,
  canDelete = false,
  onDelete,
  onReports,
  quickStatus = false,
  quickDraft = false,
  extraFilters = false,
  isPending = false,
}: {
  tasks: BomTaskRow[];
  /**
   * The word this queue's document is made of — "material", "fabric".
   *
   * It is the ONLY string the two screens differ by, so it is one prop rather
   * than three: the summary sentence, the "nothing left to do" line and the
   * empty state are all built from it below. A screen passing its own three
   * strings is how the pair drifts apart again, one sentence at a time.
   */
  noun: string;
  /** The card's middle figure — see `bomCardStats`. */
  stat: (t: BomTaskRow) => CardStat;
  /**
   * A CARD TAP OPENS THE EDITOR, on every queue, and there is no prop to
   * route it elsewhere. There was one — `onPreview`, 2026-09-21, which sent
   * Fabric BOM's tap to a right-edge detail drawer with the editor one "Open
   * BOM" press further on — and the client had it removed the same day
   * ("direct aa intha page visible aana pothum"). That was the second drawer
   * taken off this card (the first is recorded in `mobile-card-list.tsx`'s
   * `queue` prop), so the hook for a third is deliberately gone with it.
   */
  onOpen: (t: BomTaskRow) => void;
  canDelete?: boolean;
  onDelete?: (t: BomTaskRow) => void;
  /** A document report reachable straight off the card, without opening the
   *  editor — opt-in (Material BOM's caller passes nothing and is unchanged).
   *  Gated the same way `onDelete` already is: only a row that HAS a document
   *  gets the button. */
  onReports?: (t: BomTaskRow) => void;
  /** The Pending / Updated segment at the front of the search row — opt-in
   *  (Material BOM, 2026-09-21; Fabric BOM the same day, to match it). */
  quickStatus?: boolean;
  /** Adds the Draft word to the Pending / Updated box (Material BOM). */
  quickDraft?: boolean;
  /** The eight facets beside Status in the Filters panel — opt-in (Material
   *  BOM, 2026-09-21); Fabric BOM passes nothing and is unchanged. */
  extraFilters?: boolean;
  isPending?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | BomStatus>("");
  /* THE PENDING / UPDATED BOX KEEPS ITS OWN STATE (user, 2026-09-21: "Pending
     and Update should not be connected to the filters"). It used to write
     `statusFilter`, so a click moved the panel's Status facet and lit the
     Filters badge. Now the two are independent and both apply: the box narrows
     the queue, the panel narrows it further, and neither changes the other. */
  /* `"pending"`, not `""` — see `StatusSegment`'s note: the queue opens on the
     work still to do (user 2026-09-22). */
  const [quickFilter, setQuickFilter] = useState<"" | BomStatus>("pending");
  const [f, setF] = useState<QueueFacets>(NO_FACETS);

  /* THE FACETS OFFER ONLY WHAT THE QUEUE HOLDS — a customer or creator with no
     order in the queue is an option that can only produce an empty list. */
  const customerOptions = useMemo(
    () => distinctSorted(tasks.map((t) => t.customer_name)),
    [tasks],
  );
  const creatorOptions = useMemo(() => distinctSorted(tasks.map((t) => creatorName(t))), [tasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (quickStatus && quickFilter && t.status !== quickFilter) return false;
      if (extraFilters && !matchesFacets(t, f)) return false;
      if (!needle) return true;
      return [t.sc_no, t.order_code, t.po_no, t.customer_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [tasks, query, statusFilter, quickStatus, quickFilter, extraFilters, f]);

  /**
   * HOW MANY ORDERS SIT IN EACH STATE, IN THE ORDER THE WORK SHOULD BE DONE —
   * not in `BOM_STATUSES` declaration order and never sorted by count.
   *
   * `BOM_STATUS_RANK` has said "order of work for the dashboard: what needs
   * doing, first" since the statuses were extracted, and until this list read it
   * nothing on screen did: the queue was sorted by it invisibly, and the filter
   * offered the five states in declaration order. Sorting by count would bury
   * Recalculate — the one state that means a plan is silently wrong — beneath
   * Updated on any healthy queue.
   */
  const statusCounts = useMemo(
    () =>
      [...BOM_STATUSES]
        .sort((a, b) => BOM_STATUS_RANK[a] - BOM_STATUS_RANK[b])
        .map((status) => ({
          status,
          count: tasks.filter((t) => t.status === status).length,
        })),
    [tasks],
  );

  /**
   * WHAT THE QUEUE AMOUNTS TO — the one figure a merchandiser wants before
   * reading any card, and the one the cards cannot show.
   *
   * FOUR BRANCHES, BECAUSE THREE OF THEM ARE TRUE AT DIFFERENT TIMES and only
   * the first is the happy one. An order whose production quantity is refused
   * (`production_qty` null — no Approval Qty rows) cannot be added to a total,
   * so it is counted SEPARATELY rather than silently dropped: a sentence that
   * says "7,150 pieces across 3 orders" while a fourth order sits unplanned and
   * untotalled is exactly the kind of number that gets believed.
   */
  const queueSummary = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "updated");
    const totalled = open.filter((t) => t.production_qty != null);
    const untotalled = open.length - totalled.length;
    const pieces = totalled.reduce((n, t) => n + (t.production_qty ?? 0), 0);

    if (totalled.length > 0) {
      return `${fmtNumber(pieces)} pieces across ${totalled.length} order${totalled.length === 1 ? "" : "s"} waiting on a ${noun} plan${
        untotalled > 0 ? ` · ${untotalled} more cannot be totalled yet` : ""
      }`;
    }
    if (untotalled > 0) {
      return `${untotalled} order${untotalled === 1 ? "" : "s"} waiting on a ${noun} plan · none can be totalled yet`;
    }
    return tasks.length > 0 ? `Every confirmed order has a current ${noun} plan.` : null;
  }, [tasks, noun]);

  /** False when the service does not select `created_at` — then the card shows
   *  no Created line at all, rather than a dangling date. `hasCreatedInfo` is the
   *  same guard `withCreatedColumns` applies to a table. */
  const showCreated = hasCreatedInfo(tasks);


  return (
    <>
      {/* THE STATUS FACET IS THE ONE EVERY OTHER LIST SCREEN HAS — a <Label>
          and a <Select> in one cell of the Filters panel (`master-list-shell.tsx`
          is the reference) — WITH THE COUNTS IN ITS OPTIONS.

          Two shapes were tried and both were wrong, and the reason is the same
          in each: they were new controls rather than the app's control. First a
          rail of chips in a band above the list, then the same chips in the
          panel, then a dropdown of my own on the toolbar row. The client's
          answer was "i meant inside that filter add this ... check the previous
          filter from our other child" (2026-08-21). The ask was never a new
          control; it was the COUNTS, in the facet that was already there.

          What the counts buy is the whole point: a state list that says nothing
          about whether any rows are in it cannot answer "is anything stale?" —
          the question a work queue exists to answer — except by choosing
          Recalculate and looking at an empty list.

          A state with no rows is SHOWN AND NOT CHOOSABLE, never hidden: zero
          Recalculate is information, and a list that drops its empty states
          reshuffles itself every time work moves, so the option an operator
          reaches for is never in the same place twice. The one exception is the
          option currently SELECTED — disabling that would leave the control
          showing a value it refuses to offer.

          Order is `BOM_STATUS_RANK`, "what needs doing, first" — the same order
          the list itself is sorted in, and never by count. */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search RE No, PO or customer…"
        activeCount={(statusFilter ? 1 : 0) + (extraFilters ? activeFacetCount(f) : 0)}
        leading={
          quickStatus ? (
            quickDraft ? (
              <StatusSegment value={quickFilter} onChange={setQuickFilter} draft />
            ) : (
              <StatusSegment value={quickFilter} onChange={setQuickFilter} />
            )
          ) : undefined
        }
        onReset={statusFilter && !quickStatus ? () => setStatusFilter("") : undefined}
        panel={
          extraFilters ? (
            <BomFilterDrawer
              value={{ ...f, status: statusFilter }}
              onChange={(next: BomFilterValues) => {
                const { status, ...facets } = next;
                setStatusFilter(status as "" | BomStatus);
                setF({ ...facets, urgency: facets.urgency as Urgency });
              }}
              statusOptions={statusCounts.map((c) => ({
                value: c.status,
                label: `${bomStatusText(c.status)} (${c.count})`,
                disabled: c.count === 0,
              }))}
              customerOptions={customerOptions}
              creatorOptions={creatorOptions}
            />
          ) : undefined
        }
        right={
          queueSummary ? (
            <>
              {queueSummary} · {filtered.length} of {tasks.length}
            </>
          ) : (
            `${filtered.length} of ${tasks.length}`
          )
        }
      >
        {/* THE PLAIN STATUS FACET — every queue that does not ask for the
            grouped drawer (Fabric BOM). Material BOM's Status lives in the
            drawer's first group instead. */}
        {!extraFilters && (
          <div>
            <Label htmlFor="bom-status">Status</Label>
            <Select
              id="bom-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | BomStatus)}
            >
              <option value="">All ({tasks.length})</option>
              {statusCounts.map((c) => (
                <option
                  key={c.status}
                  value={c.status}
                  disabled={c.count === 0 && c.status !== statusFilter}
                >
                  {bomStatusText(c.status)} ({c.count})
                </option>
              ))}
            </Select>
          </div>
        )}
      </FilterBar>

      {/* ONE CARD PER GARMENT ORDER (operator request, 2026-08-17). This list is
          a work QUEUE — "which confirmed orders still need planning?" — and it
          was a `DataTable` of one row per order. The cards carry the same facts
          and the same click.

          `MobileCardList` rather than a card hand-rolled here. It already owns
          the tap-to-edit body, the pill slot and the footer that keeps delete a
          SIBLING of the tap target rather than a button inside a button. Its
          `md:hidden` has always been the caller's, so using it at every width
          needed one optional prop and changed no other screen.

          THE RE NO IS NO LONGER A BUTTON. It was one as a table cell, because
          that is where the click lived. The card body IS the button, so keeping
          it would nest one inside the other — the exact invalid markup that
          shaped this component. */}
      <MobileCardList<BomTaskRow>
        /* SIX ACROSS, NOW A FIXED COUNT (client 2026-08-19, then reversed
           2026-09-04: "make it static as 6 card per row"). `columns={6}` used
           to mean "auto-fit down to a 15rem floor", which stretched a short
           Fabric BOM queue's two cards past 30rem apiece — the opposite
           complaint from the one `auto-fit` was written to fix. `TRACK[6]` is
           the one place that changed; see its own note on `mobile-card-list.tsx`. */
        columns={6}
        rows={filtered}
        getKey={(t) => t.id}
        /* THE RE NO GETS ITS OWN FULL-WIDTH LINE, which is the point of the
           dense layout: it is the identity the operator scans by, ~125px of
           mono, and it used to share a row with a pill that could be 88px of
           "Recalculate". */
        title={(t) => <span className="font-mono">{t.sc_no ?? t.order_code ?? "—"}</span>}
        /* CUSTOMER AND PO ON THE SECONDARY LINE, under the RE No. Mono on the PO
           only — a customer name in mono reads as a code. The card truncates the
           line; a tap opens the BOM, whose header names the order in full. */
        subtitle={(t) => (
          <>
            {t.customer_name ?? "—"}
            {t.po_no ? <span className="font-mono"> · {t.po_no}</span> : null}
          </>
        )}
        pill={(t) => <BomQueuePill status={t.status} />}
        stats={(t) => bomCardStats(t, stat(t))}
        /* THE QUEUE CARD (operator, 2026-09-18, reference screenshot) — see
           `queue` on `MobileCardList`. A tap opens the BOM straight away; no
           drawer, no slide-over and nothing on hover. Replaces the 2026-09-04
           floating status badge: the reference marks the state with the side
           stripe. */
        queue
        /* THE STRIPE — red on Pending, green once the plan is current. The
           same tone as the pill, from the same function: the pill is read one
           card at a time, the stripe down a whole grid at once, and this list
           is SORTED by `BOM_STATUS_RANK` ("what needs doing, first"). */
        tone={(t) => queueTone(t.status)}
        accent={(t) => QUEUE_THEME[t.status]?.edge}
        /* THE CREATED PAIR SHARES THE DRAWER'S FOOTER WITH THE BUTTONS —
           AGENTS.md wants it APPENDED to the screen's own meta, not
           substituted for it. Still gated on `hasCreatedInfo`, so a service
           that stops selecting `created_at` shows nothing rather than a
           dangling date. */
        /* "Created " IN WORDS — in the drawer the pair sits alone beside the
           buttons, with no column header to say what the date is. */
        footerNote={showCreated ? (t) => `Created ${createdMeta(t)}` : undefined}
        onEdit={onOpen}
        canDelete={canDelete}
        /* Only an order that HAS a BOM has anything to delete — that is the
           "Pending" case, and it is the whole reason the queue lists ORDERS.
           Without it the button renders on every card and does nothing when
           pressed. */
        canDeleteRow={(t) => !!t.bom_id}
        onDelete={onDelete}
        onReports={onReports}
        canReportsRow={(t) => !!t.bom_id}
        isPending={isPending}
        empty={`No confirmed garment orders yet. A ${noun} BOM is planned against an order.`}
      />
    </>
  );
}
