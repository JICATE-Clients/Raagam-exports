"use client";

import Link from "next/link";
import { Baloo_2 } from "next/font/google";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, BadgeCheck, CalendarCheck, Check, ChevronRight, Flag, PencilRuler, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { buttonClasses } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import type { CalKind } from "@/lib/my-calendar/data";

/**
 * THE WELCOME CARD (user 2026-10-29, approved mock-up
 * https://claude.ai/artifact/DtVmDQmHnAdSJYqLAXUh9K, "okay apply it").
 *
 * Nool — Raagam Assist's spool — walks in, says Vanakkam, and tells the
 * operator how the day stands; the list beneath is what is left. While work is
 * open Nool points at it and encourages; when everything is done Nool holds up
 * a hand, and clicking THAT HAND is the high five (user: no separate button).
 *
 * Decisions the mock-up settled, so they are not re-litigated here:
 * - **Nool never names a task.** The list does that; the bubble only counts and
 *   encourages, so the two never say the same thing twice.
 * - **Done work leaves the list** for one "Done today" line of chips, so the
 *   list shrinks as the day goes on. No filter chips: a personal day is a
 *   handful of rows.
 * - **Nothing is ticked here.** A task is done when its record is done; this
 *   card only reads `getCalendar`, the same loader as My Calendar.
 * - **Logo colours** on Nool (roundel green thread, wordmark blue flanges and
 *   shoes) and Baloo 2 for the one greeting line, echoing the wordmark's
 *   rounded letters. Everything else is the app's own type.
 * - **No colour rail** on any row (user 2026-10-29).
 *
 * The page renders complete without JavaScript: Nool standing, the line
 * written out. The walk-in plays once a day per browser (localStorage, a
 * convenience only); after that Nool just waves. `AutoRefresh` re-renders this
 * with new props every minute, and a rise in the done count is what makes Nool
 * nod, or cheer when it reaches the total.
 */

const brandFace = Baloo_2({ subsets: ["latin"], weight: ["700"], display: "swap" });

export type NoolTask = {
  id: string;
  kind: CalKind;
  title: string;
  reNo: string | null;
  date: string;
  /** Days past its date and still open; 0 for today's work and anything done. */
  daysLate: number;
  done: boolean;
  href: string;
};

/** Labels and tones are My Calendar's own (`KINDS` in my-calendar.tsx), so the two screens agree. */
const KIND: Record<CalKind, { label: string; icon: LucideIcon; well: string }> = {
  ta: { label: "T&A", icon: CalendarCheck, well: "bg-info-soft text-info" },
  approval: { label: "Buyer approval", icon: BadgeCheck, well: "bg-warning-soft text-warning" },
  milestone: { label: "Work Flow", icon: Flag, well: "bg-primary-soft text-primary" },
  cad: { label: "CAD", icon: PencilRuler, well: "bg-success-soft text-success" },
  ship: { label: "Ship date", icon: Truck, well: "bg-surface-muted text-foreground" },
};

/** How many open rows the card lists before handing over to My Calendar. */
const SHOWN = 8;
const WALK_KEY = "raagam:nool-walked";
const HIGH5_KEY = "raagam:nool-high-five";

type Pose = "walk" | "wave" | "point" | "cheer" | "highfive" | "slap" | "relax" | "nod";
type Seg = { t: string; b?: boolean };
type Line = { pose: Pose; segs: Seg[] };

/** What Nool says, picked from the counts. Fixed sentences: instant, and never wrong. */
function lineFor(total: number, open: number, late: number, highFived: boolean, note?: string): Line {
  const done = total - open;
  if (note) return { pose: "relax", segs: [{ t: note }] };
  if (total === 0) return { pose: "relax", segs: [{ t: "Nothing due today. A clear desk!" }] };
  if (open === 0) {
    return highFived
      ? { pose: "relax", segs: [{ t: "That's the day. See you tomorrow!" }] }
      : { pose: "highfive", segs: [{ t: `All ${total} done! ` , b: true }, { t: "Give me a high five!" }] };
  }
  if (open === 1) return { pose: "point", segs: [{ t: "Just " }, { t: "one left", b: true }, { t: ". Finish it and we'll high-five!" }] };
  if (done === 0) {
    const lateLine = late === 0 ? " Let's get going!" : late === 1 ? " One is overdue, so let's clear that first." : ` ${late} are overdue, so let's clear those first.`;
    return { pose: "point", segs: [{ t: `${open} things`, b: true }, { t: ` today.${lateLine}` }] };
  }
  return { pose: "point", segs: [{ t: `${done} done, ${open} to go.`, b: true }, { t: done * 2 >= total ? " Nearly there!" : " Keep it up!" }] };
}

const segLength = (segs: Seg[]) => segs.reduce((n, s) => n + s.t.length, 0);

export function NoolGreeter({
  name,
  dateLabel,
  today,
  tasks,
  note,
  calendarHref,
}: {
  name: string;
  dateLabel: string;
  today: string;
  tasks: NoolTask[];
  /** Said instead of the day's line when the tasks cannot be shown (no staff link, no access). */
  note?: string;
  calendarHref: string;
}) {
  const open = tasks.filter((t) => !t.done).sort((a, b) => b.daysLate - a.daysLate);
  const done = tasks.filter((t) => t.done);
  const late = open.filter((t) => t.daysLate > 0).length;

  const [highFived, setHighFived] = useState(false);
  const line = lineFor(tasks.length, open.length, late, highFived, note);
  const [pose, setPose] = useState<Pose>(line.pose);
  const [entering, setEntering] = useState(false);
  const [bubble, setBubble] = useState(true);
  const [typed, setTyped] = useState(Number.POSITIVE_INFINITY);
  const [peek, setPeek] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const typer = useRef<number | null>(null);
  const reduced = useRef(false);
  const lastDone = useRef<number | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const walkerRef = useRef<HTMLButtonElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, reduced.current ? 0 : ms));
  };
  const stop = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (typer.current != null) window.clearInterval(typer.current);
    typer.current = null;
  };
  const type = (segs: Seg[]) => {
    if (typer.current != null) window.clearInterval(typer.current);
    if (reduced.current) return setTyped(Number.POSITIVE_INFINITY);
    const total = segLength(segs);
    let n = 0;
    setTyped(0);
    typer.current = window.setInterval(() => {
      n += 2;
      setTyped(n);
      if (n >= total && typer.current != null) {
        window.clearInterval(typer.current);
        typer.current = null;
        setTyped(Number.POSITIVE_INFINITY);
      }
    }, 24);
  };

  const sparkle = (big = false) => {
    const c = sparkRef.current, card = cardRef.current, w0 = walkerRef.current;
    if (reduced.current || !c || !card || !w0) return;
    const w = (c.width = card.clientWidth), h = (c.height = card.clientHeight);
    const r = w0.getBoundingClientRect(), b = card.getBoundingClientRect();
    const cx = r.right - b.left - 6, cy = r.top - b.top + 22;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const cols = ["#0493db", "#85c227", "#b6e05f", "#6cc6f2"];
    const n = big ? 46 : 26;
    const ps = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2, s = (big ? 2 : 1.3) + Math.random() * 2;
      return { x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c: cols[i % 4] };
    });
    let f = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy = p.vy * 0.95 + 0.05;
        ctx.globalAlpha = Math.max(0, 1 - f / 55);
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, big ? 2.6 : 2, 0, 7); ctx.fill();
      }
      if (++f < 55) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    tick();
  };

  const settle = (l: Line) => {
    if (l.pose === "highfive") {
      setPose("cheer");
      sparkle();
      later(() => setPose("highfive"), 1600);
    } else setPose(l.pose);
  };

  /** Wave, say the line, then take the line's pose. */
  const greet = (walk: boolean, l: Line = line) => {
    stop();
    if (walk && !reduced.current) {
      setBubble(false);
      setEntering(true);
      setPose("walk");
    }
    later(() => {
      setEntering(false);
      setPose("wave");
      setBubble(true);
      type(l.segs);
      later(() => settle(l), 2200);
    }, walk ? 1900 : 0);
  };

  const highFive = () => {
    if (pose !== "highfive") return;
    stop();
    setPose("slap");
    sparkle(true);
    try { localStorage.setItem(HIGH5_KEY, today); } catch {}
    later(() => {
      setHighFived(true);
      const next = lineFor(tasks.length, 0, 0, true);
      setPose(next.pose);
      type(next.segs);
    }, 700);
  };

  // Once per mount: reduced motion, today's walk and high five. The first
  // render is Nool standing with the line written out, so the page is whole
  // without JavaScript; the greeting then starts from a timer, not the effect
  // body, so no state is set while React is still committing.
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let walked = false, fived = false;
    try {
      walked = localStorage.getItem(WALK_KEY) === today;
      fived = localStorage.getItem(HIGH5_KEY) === today;
      if (!walked) localStorage.setItem(WALK_KEY, today);
    } catch {}
    const start = window.setTimeout(() => {
      if (fived) setHighFived(true);
      greet(!walked, lineFor(tasks.length, open.length, late, fived, note));
    }, 0);
    return () => {
      window.clearTimeout(start);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A refresh that brings a newly closed task: nod (or cheer at the last one).
  useEffect(() => {
    const prev = lastDone.current;
    lastDone.current = done.length;
    if (prev == null) return;
    const react = window.setTimeout(() => {
      if (done.length <= prev) return setPose(line.pose);
      setJustDone(done[done.length - 1]?.id ?? null);
      stop();
      type(line.segs);
      if (line.pose === "highfive") settle(line);
      else {
        setPose("nod");
        later(() => setPose(line.pose), 1000);
      }
    }, 0);
    return () => window.clearTimeout(react);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done.length, open.length]);

  const shown = open.slice(0, SHOWN);
  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape" && peek) {
      e.stopPropagation();
      setPeek(null);
      return;
    }
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key];
    if (!step) return;
    const rows = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>("[data-nool-row]") ?? []);
    const cols = window.matchMedia("(min-width: 768px)").matches ? 2 : 1;
    const at = rows.indexOf(e.currentTarget);
    const go = rows[at + (Math.abs(step) === 2 ? Math.sign(step) * cols : step)];
    if (go) {
      e.preventDefault();
      go.focus();
    }
  };

  const said = line.segs.map((s, i) => {
    const before = line.segs.slice(0, i).reduce((n, x) => n + x.t.length, 0);
    const text = s.t.slice(0, Math.max(0, typed - before));
    return s.b ? <b key={i} className="font-semibold text-foreground">{text}</b> : <span key={i}>{text}</span>;
  });

  return (
    <section ref={cardRef} aria-label="Your day" className="relative isolate overflow-hidden rounded-2xl border border-border bg-surface p-4 pt-3 shadow-[0_12px_32px_-22px_rgba(4,147,219,0.45)]">
      <style href="nool-greeter" precedence="medium">{NOOL_CSS}</style>
      <canvas ref={sparkRef} aria-hidden className="pointer-events-none absolute inset-0 z-[2] size-full" />

      <div className="flex flex-wrap items-end gap-3.5">
        <div className="relative h-[86px] w-[72px] flex-none sm:h-[108px] sm:w-[90px]">
          <button
            ref={walkerRef}
            type="button"
            onClick={() => (pose === "highfive" ? highFive() : greet(false))}
            aria-label={pose === "highfive" ? "High five Nool" : "Nool, your assistant. Click to say hi again."}
            title={pose === "highfive" ? "High five!" : undefined}
            className={cn("absolute bottom-0 left-0 w-full cursor-pointer rounded-control", entering && "ng-entering")}
          >
            <NoolFigure pose={pose} />
          </button>
        </div>

        <div
          className={cn(
            "relative mt-2 min-w-0 max-w-[32rem] flex-1 self-start rounded-2xl border border-border bg-surface px-4 pb-2.5 pt-2 shadow-[0_10px_24px_-16px_rgba(4,147,219,0.55)] sm:flex-none",
            "before:absolute before:-left-[7px] before:top-6 before:size-3 before:rotate-45 before:border-b before:border-l before:border-border before:bg-surface before:content-['']",
            bubble ? "ng-pop" : "invisible",
          )}
        >
          <h2 className={cn(brandFace.className, "text-[1.4rem] leading-tight text-heading")}>
            Vanakkam, <span className="text-brand-blue">{name}</span>
          </h2>
          <p className="min-h-[1.5em] text-[13.5px] text-muted-foreground" aria-live="polite">
            {said}
            {Number.isFinite(typed) && <span className="ng-caret" aria-hidden />}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">{dateLabel}</p>
        </div>

      </div>

      {tasks.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2.5 px-2">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold">
              To do
              <span className="rounded-full border border-border bg-surface-muted px-1.5 text-[11px] font-bold tabular-nums">{open.length}</span>
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              <b className="font-semibold text-foreground">{done.length} of {tasks.length}</b> done today
            </span>
          </div>

          <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2">
            {open.length === 0 && (
              <p className="col-span-full flex items-center gap-2.5 px-2 py-3 text-[13px] text-muted-foreground">
                <span className="grid size-[30px] place-items-center rounded-lg bg-success-soft text-success"><Check className="size-4" /></span>
                Nothing left to do today.
              </p>
            )}
            {shown.map((t, i) => {
              const k = KIND[t.kind];
              const Icon = k.icon;
              const isOpen = peek === t.id;
              const peekRowEnds = (cols: number) => {
                const at = shown.findIndex((x) => x.id === peek);
                return at >= 0 && Math.floor(at / cols) === Math.floor(i / cols) && ((i + 1) % cols === 0 || i === shown.length - 1);
              };
              const p = shown.find((x) => x.id === peek);
              const panel = p && (
                <div className="col-span-full my-1.5 grid grid-cols-1 items-center gap-3 rounded-xl border border-border bg-surface-muted px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
                    {[
                      ["Type", KIND[p.kind].label],
                      ["RE No", p.reNo ?? "—"],
                      ["Due", fmtDate(p.date)],
                      ["Status", p.daysLate > 0 ? `${p.daysLate} day${p.daysLate > 1 ? "s" : ""} late` : "Due today"],
                    ].map(([dt, dd]) => (
                      <div key={dt}>
                        <dt className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{dt}</dt>
                        <dd className="text-[13px] font-semibold tabular-nums">{dd}</dd>
                      </div>
                    ))}
                  </dl>
                  <Link href={p.href} className={buttonClasses({ size: "sm" })}>
                    <ArrowUpRight className="size-4" />
                    Open {KIND[p.kind].label}
                  </Link>
                </div>
              );
              return (
                <Fragment key={t.id}>
                  <button
                    type="button"
                    data-nool-row=""
                    aria-expanded={isOpen}
                    onClick={() => setPeek(isOpen ? null : t.id)}
                    onKeyDown={onRowKey}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className="ng-rise group grid w-full grid-cols-[30px_minmax(0,1fr)_auto_16px] items-center gap-2.5 border-b border-border px-2 py-2 text-left transition-colors hover:bg-surface-muted aria-expanded:bg-surface-muted"
                  >
                    <span className={cn("grid size-[30px] place-items-center rounded-lg", k.well)}><Icon className="size-[15px]" /></span>
                    <span className="min-w-0">
                      <Truncated text={t.title} className="block text-[13.5px] font-semibold" />
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {k.label}{t.reNo ? ` · ${t.reNo}` : ""}
                      </span>
                    </span>
                    {t.daysLate > 0 ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                        <span className="ng-pulse size-1.5 rounded-full bg-current" aria-hidden />
                        {t.daysLate} day{t.daysLate > 1 ? "s" : ""} late
                      </span>
                    ) : (
                      <span />
                    )}
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-expanded:rotate-90 group-aria-expanded:opacity-100" />
                  </button>
                  {/* The peek follows the last row of its line: one column on a phone, two from md. */}
                  {panel && peekRowEnds(2) && <div className="col-span-full hidden md:block">{panel}</div>}
                  {panel && peekRowEnds(1) && <div className="col-span-full md:hidden">{panel}</div>}
                </Fragment>
              );
            })}
          </div>

          {open.length > SHOWN && (
            <Link href={calendarHref} className="px-2 pt-1 text-xs font-semibold text-primary hover:underline">
              +{open.length - SHOWN} more in My Calendar →
            </Link>
          )}

          {done.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5">
              <span className="mr-0.5 text-xs font-semibold text-muted-foreground">Done today</span>
              {done.map((t) => (
                <Link
                  key={t.id}
                  href={t.href}
                  className={cn(
                    "inline-flex h-[26px] items-center gap-1 rounded-full bg-success-soft px-2.5 text-xs font-semibold text-success hover:underline",
                    justDone === t.id && "ng-pop",
                  )}
                >
                  <Check className="size-3.5" strokeWidth={2.6} />
                  {t.title}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Nool with jointed limbs: shoulder > elbow > wrist, hip > knee. Each joint is
 * a group turning about its own point, so a pose is a set of angles in CSS.
 * The chat's small Nool (`assist-buddy.tsx`) is a separate drawing and is not
 * touched by any of this.
 */
function NoolFigure({ pose }: { pose: Pose }) {
  return (
    <svg className="ng" viewBox="-20 -8 160 180" data-pose={pose} aria-hidden>
      <ellipse className="ng-shadow" cx="60" cy="164" rx="36" ry="4.5" />
      <g className="ng-root">
        <g className="ng-hipL">
          <path className="ng-bone" d="M47 121 L47 139" />
          <g className="ng-knL">
            <path className="ng-bone" d="M47 139 L47 154" />
            <path className="ng-shoe" d="M41 152 h9 q9 0 9 6 v1.5 h-19.5 q-2 0 -1.6 -3.4 z" />
            <rect className="ng-sole" x="39" y="158.6" width="20" height="1.6" rx=".8" />
          </g>
        </g>
        <g className="ng-hipR">
          <path className="ng-bone" d="M73 121 L73 139" />
          <g className="ng-knR">
            <path className="ng-bone" d="M73 139 L73 154" />
            <path className="ng-shoe" d="M67 152 h9 q9 0 9 6 v1.5 h-19.5 q-2 0 -1.6 -3.4 z" />
            <rect className="ng-sole" x="65" y="158.6" width="20" height="1.6" rx=".8" />
          </g>
        </g>
        <Arm side="l" />
        <path className="ng-needle" d="M80 30 L94 3" />
        <path className="ng-thread" d="M92 7 C 116 14, 114 44, 98 60" />
        <rect className="ng-body" x="22" y="38" width="76" height="74" />
        <g fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="2">
          {[44, 56, 68, 80, 92, 104].map((y) => (
            <path key={y} d={`M22 ${y} Q60 ${y + 3} 98 ${y}`} />
          ))}
        </g>
        <rect x="22" y="38" width="10" height="74" fill="#000" opacity=".08" />
        <rect className="ng-flange" x="14" y="27" width="92" height="14" rx="7" />
        <rect x="20" y="30" width="40" height="3" rx="1.5" fill="#fff" opacity=".35" />
        <rect className="ng-flange" x="14" y="109" width="92" height="14" rx="7" />
        <rect className="ng-label" x="32" y="50" width="56" height="48" rx="9" />
        <path className="ng-star" d="M80 86.5 l1.5 3.1 3.4.5 -2.5 2.4 .6 3.4 -3-1.6 -3 1.6 .6-3.4 -2.5-2.4 3.4-.5z" />
        <g className="ng-eyes">
          <g className="ng-pupils">
            <ellipse className="ng-ink" cx="49" cy="70" rx="4.4" ry="5.8" />
            <ellipse className="ng-ink" cx="71" cy="70" rx="4.4" ry="5.8" />
            <circle cx="50.6" cy="67.6" r="1.6" fill="#fff" />
            <circle cx="72.6" cy="67.6" r="1.6" fill="#fff" />
          </g>
        </g>
        <g className="ng-happy ng-face">
          <path d="M44 72 Q49 64 54 72" />
          <path d="M66 72 Q71 64 76 72" />
        </g>
        <circle className="ng-cheek" cx="41" cy="80" r="3.6" />
        <circle className="ng-cheek" cx="79" cy="80" r="3.6" />
        <path className="ng-smile ng-face" d="M54 82 Q60 88 66 82" />
        <path className="ng-grin ng-face" d="M52 81 Q60 92 68 81 Z" fill="#c2414b" />
        <Arm side="r" />
        <g className="ng-stars">
          <path fill="var(--brand-green)" d="M4 12 l3 6.2 6.8 1 -4.9 4.8 1.2 6.8 -6.1-3.2 -6.1 3.2 1.2-6.8 -4.9-4.8 6.8-1z" />
          <path fill="var(--brand-blue)" d="M120 16 l2.2 4.5 5 .7 -3.6 3.5 .9 5 -4.5-2.4 -4.5 2.4 .9-5 -3.6-3.5 5-.7z" />
          <path fill="var(--brand-green)" d="M22 -2 l1.4 2.9 3.2.5 -2.3 2.2 .5 3.2 -2.8-1.5 -2.8 1.5 .5-3.2 -2.3-2.2 3.2-.5z" />
        </g>
      </g>
    </svg>
  );
}

/** One arm, drawn hanging straight down from its shoulder; the pose CSS turns the joints. */
function Arm({ side }: { side: "l" | "r" }) {
  const x = side === "l" ? 20 : 100;
  const S = side === "l" ? "L" : "R";
  const thumbX = side === "l" ? x - 9 : x + 6.2;
  const thumbRot = side === "l" ? `rotate(32 ${x - 7.6} 107)` : `rotate(-32 ${x + 7.6} 107)`;
  return (
    <g className={`ng-sh${S}`}>
      <path className="ng-bone" d={`M${x} 76 L${x} 93`} />
      <g className={`ng-el${S}`}>
        <path className="ng-bone" d={`M${x} 93 L${x} 107`} />
        <g className={`ng-wr${S}`}>
          {side === "r" && (
            <>
              <circle className="ng-ring" cx={x} cy="114" r="13" />
              <circle className="ng-ring ng-ring2" cx={x} cy="114" r="13" />
            </>
          )}
          <g className="ng-fist">
            <circle className="ng-glove" cx={x} cy="112" r="6.2" />
            <path className="ng-crease" d={`M${x - 4} 111 h8 M${x - 3.5} 114 h7`} />
          </g>
          {side === "r" && (
            <g className="ng-point">
              <circle className="ng-glove" cx={x} cy="111.5" r="6.2" />
              <rect className="ng-glove" x={x - 1.5} y="114" width="3.2" height="11" rx="1.6" />
            </g>
          )}
          <g className="ng-open">
            <rect className="ng-glove" x={x - 6} y="106" width="12" height="10" rx="4" />
            <rect className="ng-glove" x={x - 5.8} y="113" width="2.8" height="8" rx="1.4" />
            <rect className="ng-glove" x={x - 2.6} y="114" width="2.8" height="9.5" rx="1.4" />
            <rect className="ng-glove" x={x + 0.6} y="114" width="2.8" height="9.5" rx="1.4" />
            <rect className="ng-glove" x={x + 3.8} y="113" width="2.8" height="8" rx="1.4" />
            <rect className="ng-glove" x={thumbX} y="106.5" width="2.8" height="7.5" rx="1.4" transform={thumbRot} />
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * The styles travel with the component (the reason is in assist-buddy.tsx: a
 * stale global sheet once drew the spool solid black). React hoists one
 * `<style href precedence>` however many render. Fixed art colours on the
 * character so it reads the same on either theme; the logo's two colours come
 * from `--brand-green` / `--brand-blue`.
 */
const NOOL_CSS = `
.ng { width: 100%; height: auto; overflow: visible; display: block; }
.ng-shadow { fill: currentColor; opacity: .1; }
.ng-body { fill: var(--brand-green); }
.ng-flange { fill: var(--brand-blue); }
.ng-label { fill: #fff; }
.ng-star { fill: var(--brand-green); }
.ng-bone { stroke: #0b3150; stroke-width: 5; stroke-linecap: round; fill: none; }
.ng-glove { fill: #fff; stroke: #0b3150; stroke-width: 1.6; stroke-linejoin: round; }
.ng-crease { stroke: #0b3150; stroke-width: 1.1; stroke-linecap: round; fill: none; opacity: .55; }
.ng-shoe { fill: var(--brand-blue); }
.ng-sole { fill: #fff; opacity: .9; }
.ng-face { stroke: #0b3150; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.ng-grin { fill: #c2414b; }
.ng-ink { fill: #0b3150; }
.ng-cheek { fill: #f5a3a3; opacity: .85; }
.ng-needle { stroke: #9aa6b2; stroke-width: 3; stroke-linecap: round; }
.ng-thread { stroke: var(--brand-blue); stroke-width: 2.2; fill: none; stroke-dasharray: 5 3; stroke-linecap: round; }
.ng :is(.ng-happy, .ng-grin, .ng-stars, .ng-open, .ng-point) { opacity: 0; transition: opacity .15s; }
.ng :is(.ng-eyes, .ng-smile, .ng-fist) { transition: opacity .15s; }

.ng :is(.ng-root, .ng-shR, .ng-elR, .ng-wrR, .ng-shL, .ng-elL, .ng-wrL, .ng-hipL, .ng-knL, .ng-hipR, .ng-knR) { transform-box: view-box; }
.ng .ng-root { transform-origin: 60px 162px; }
.ng .ng-shR { transform-origin: 100px 76px; transform: rotate(-16deg); }
.ng .ng-elR { transform-origin: 100px 93px; transform: rotate(-12deg); }
.ng .ng-wrR { transform-origin: 100px 108px; }
.ng .ng-shL { transform-origin: 20px 76px; transform: rotate(16deg); }
.ng .ng-elL { transform-origin: 20px 93px; transform: rotate(12deg); }
.ng .ng-wrL { transform-origin: 20px 108px; }
.ng .ng-hipL { transform-origin: 47px 121px; } .ng .ng-knL { transform-origin: 47px 139px; }
.ng .ng-hipR { transform-origin: 73px 121px; } .ng .ng-knR { transform-origin: 73px 139px; }
.ng :is(.ng-shR, .ng-elR, .ng-wrR, .ng-shL, .ng-elL, .ng-wrL, .ng-hipL, .ng-knL, .ng-hipR, .ng-knR) { transition: transform .45s cubic-bezier(.3,1.25,.5,1); }
.ng .ng-eyes { transform-box: fill-box; transform-origin: center; animation: ng-blink 4.6s infinite; }
.ng .ng-pupils { transition: transform .3s; }
.ng .ng-stars { transform-box: fill-box; transform-origin: center; }
.ng .ng-ring { fill: none; stroke: var(--brand-green); stroke-width: 2.5; opacity: 0; transform-box: fill-box; transform-origin: center; }

/* WALK */
.ng[data-pose="walk"] .ng-hipR { animation: ng-hip .8s linear infinite; }
.ng[data-pose="walk"] .ng-knR { animation: ng-knee .8s linear infinite; }
.ng[data-pose="walk"] .ng-hipL { animation: ng-hip .8s linear -.4s infinite; }
.ng[data-pose="walk"] .ng-knL { animation: ng-knee .8s linear -.4s infinite; }
.ng[data-pose="walk"] .ng-shR { animation: ng-swing .8s ease-in-out infinite; }
.ng[data-pose="walk"] .ng-shL { animation: ng-swing .8s ease-in-out -.4s infinite; }
.ng[data-pose="walk"] :is(.ng-elR, .ng-elL) { transform: rotate(-28deg); }
.ng[data-pose="walk"] .ng-root { animation: ng-gait .4s ease-in-out infinite; }

/* WAVE */
.ng[data-pose="wave"] .ng-shR { transform: rotate(-158deg); }
.ng[data-pose="wave"] .ng-elR { animation: ng-waveEl .42s ease-in-out infinite alternate; }
.ng[data-pose="wave"] .ng-wrR { animation: ng-waveWr .42s ease-in-out -.12s infinite alternate; }
.ng[data-pose="wave"] .ng-shR .ng-open { opacity: 1; } .ng[data-pose="wave"] .ng-shR .ng-fist { opacity: 0; }
.ng[data-pose="wave"] .ng-root { animation: ng-idle 3s ease-in-out infinite; }

/* POINT: down at the list, other hand on the hip */
.ng[data-pose="point"] .ng-shR { transform: rotate(-34deg); }
.ng[data-pose="point"] .ng-elR { transform: rotate(-14deg); animation: ng-jab 1.6s ease-in-out infinite; }
.ng[data-pose="point"] .ng-shR .ng-fist { opacity: 0; } .ng[data-pose="point"] .ng-point { opacity: 1; }
.ng[data-pose="point"] .ng-shL { transform: rotate(42deg); } .ng[data-pose="point"] .ng-elL { transform: rotate(-104deg); }
.ng[data-pose="point"] .ng-pupils { transform: translate(3px, 3px); }
.ng[data-pose="point"] .ng-root { animation: ng-lean 2.4s ease-in-out infinite; }

/* CHEER */
.ng[data-pose="cheer"] .ng-shR { transform: rotate(-164deg); }
.ng[data-pose="cheer"] .ng-shL { transform: rotate(164deg); }
.ng[data-pose="cheer"] .ng-elR { animation: ng-pumpR .35s ease-in-out infinite alternate; }
.ng[data-pose="cheer"] .ng-elL { animation: ng-pumpL .35s ease-in-out infinite alternate; }
.ng[data-pose="cheer"] .ng-open { opacity: 1; } .ng[data-pose="cheer"] .ng-fist { opacity: 0; }
.ng[data-pose="cheer"] .ng-hipL { transform: rotate(14deg); } .ng[data-pose="cheer"] .ng-hipR { transform: rotate(-14deg); }
.ng[data-pose="cheer"] .ng-root { animation: ng-hop .7s cubic-bezier(.3,.7,.4,1) infinite; }
.ng[data-pose="cheer"] :is(.ng-happy, .ng-grin, .ng-stars) { opacity: 1; }
.ng[data-pose="cheer"] :is(.ng-eyes, .ng-smile) { opacity: 0; }
.ng[data-pose="cheer"] .ng-stars { animation: ng-twinkle .7s ease-in-out infinite alternate; }

/* HIGH FIVE: the raised hand is the button; rings pulse from the palm */
.ng[data-pose="highfive"] .ng-shR { transform: rotate(-138deg); }
.ng[data-pose="highfive"] .ng-elR { transform: rotate(-36deg); }
.ng[data-pose="highfive"] .ng-wrR { transform: rotate(-8deg) scale(1.22); animation: ng-ready 1.2s ease-in-out infinite; }
.ng[data-pose="highfive"] .ng-shR .ng-open { opacity: 1; } .ng[data-pose="highfive"] .ng-shR .ng-fist { opacity: 0; }
.ng[data-pose="highfive"] .ng-shL { transform: rotate(42deg); } .ng[data-pose="highfive"] .ng-elL { transform: rotate(-104deg); }
.ng[data-pose="highfive"] :is(.ng-happy, .ng-grin) { opacity: 1; }
.ng[data-pose="highfive"] :is(.ng-eyes, .ng-smile) { opacity: 0; }
.ng[data-pose="highfive"] .ng-root { animation: ng-idle 2s ease-in-out infinite; }
.ng[data-pose="highfive"] .ng-ring { animation: ng-ring 1.4s ease-out infinite; }
.ng[data-pose="highfive"] .ng-ring2 { animation-delay: .7s; }

/* SLAP */
.ng[data-pose="slap"] .ng-shR { transform: rotate(-120deg); transition-duration: .12s; }
.ng[data-pose="slap"] .ng-elR { transform: rotate(-2deg); transition-duration: .12s; }
.ng[data-pose="slap"] .ng-wrR { transform: scale(1.3); transition-duration: .12s; }
.ng[data-pose="slap"] .ng-shR .ng-open, .ng[data-pose="slap"] .ng-stars { opacity: 1; } .ng[data-pose="slap"] .ng-shR .ng-fist { opacity: 0; }
.ng[data-pose="slap"] .ng-shL { transform: rotate(42deg); } .ng[data-pose="slap"] .ng-elL { transform: rotate(-104deg); }
.ng[data-pose="slap"] :is(.ng-happy, .ng-grin) { opacity: 1; }
.ng[data-pose="slap"] :is(.ng-eyes, .ng-smile) { opacity: 0; }

/* RELAX: hands on hips */
.ng[data-pose="relax"] .ng-shR { transform: rotate(-42deg); } .ng[data-pose="relax"] .ng-elR { transform: rotate(104deg); }
.ng[data-pose="relax"] .ng-shL { transform: rotate(42deg); } .ng[data-pose="relax"] .ng-elL { transform: rotate(-104deg); }
.ng[data-pose="relax"] .ng-root { animation: ng-idle 3.4s ease-in-out infinite; }
.ng[data-pose="relax"] .ng-happy { opacity: 1; } .ng[data-pose="relax"] .ng-eyes { opacity: 0; }

/* NOD: a task just closed */
.ng[data-pose="nod"] .ng-shR { transform: rotate(-120deg); } .ng[data-pose="nod"] .ng-elR { transform: rotate(-60deg); }
.ng[data-pose="nod"] .ng-root { animation: ng-hop .5s ease-in-out 2; }
.ng[data-pose="nod"] .ng-happy { opacity: 1; } .ng[data-pose="nod"] .ng-eyes { opacity: 0; }

.ng-entering { animation: ng-enter 1.9s cubic-bezier(.35,.6,.4,1) both; }
.ng-pop { animation: ng-pop .35s cubic-bezier(.3,1.4,.5,1) both; }
.ng-rise { animation: ng-rise .4s cubic-bezier(.2,.8,.2,1) both; }
.ng-pulse { animation: ng-pulse 1.8s ease-in-out infinite; }
.ng-caret { display: inline-block; width: 2px; height: 1em; margin-left: 1px; vertical-align: -2px; background: var(--brand-green); animation: ng-caret .8s steps(1) infinite; }

@keyframes ng-blink { 0%,93%,100% { transform: scaleY(1); } 96% { transform: scaleY(.1); } }
@keyframes ng-hip { 0% { transform: rotate(-24deg); } 25% { transform: rotate(-4deg); } 50% { transform: rotate(18deg); } 75% { transform: rotate(-6deg); } 100% { transform: rotate(-24deg); } }
@keyframes ng-knee { 0% { transform: rotate(4deg); } 30% { transform: rotate(0); } 50% { transform: rotate(14deg); } 68% { transform: rotate(52deg); } 88% { transform: rotate(18deg); } 100% { transform: rotate(4deg); } }
@keyframes ng-swing { 0%,100% { transform: rotate(14deg); } 50% { transform: rotate(-32deg); } }
@keyframes ng-gait { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3.5px); } }
@keyframes ng-waveEl { from { transform: rotate(-30deg); } to { transform: rotate(22deg); } }
@keyframes ng-waveWr { from { transform: rotate(-12deg); } to { transform: rotate(12deg); } }
@keyframes ng-jab { 0%,100% { transform: rotate(-14deg); } 50% { transform: rotate(-4deg); } }
@keyframes ng-lean { 0%,100% { transform: rotate(0); } 50% { transform: rotate(3deg); } }
@keyframes ng-pumpR { from { transform: rotate(-14deg); } to { transform: rotate(14deg); } }
@keyframes ng-pumpL { from { transform: rotate(14deg); } to { transform: rotate(-14deg); } }
@keyframes ng-ready { 0%,100% { transform: rotate(-8deg) scale(1.22); } 50% { transform: rotate(4deg) scale(1.22); } }
@keyframes ng-ring { 0% { transform: scale(.6); opacity: .95; } 100% { transform: scale(1.9); opacity: 0; } }
@keyframes ng-idle { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes ng-hop { 0%,100% { transform: translateY(0) scale(1); } 20% { transform: scale(1.05,.94); } 50% { transform: translateY(-12px) scale(.97,1.04); } }
@keyframes ng-twinkle { from { transform: scale(.85); opacity: .6; } to { transform: scale(1.1); opacity: 1; } }
@keyframes ng-enter { from { transform: translateX(-150px); } to { transform: none; } }
@keyframes ng-pop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
@keyframes ng-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes ng-pulse { 50% { opacity: .3; } }
@keyframes ng-caret { 50% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .ng *, .ng-entering, .ng-pop, .ng-rise, .ng-pulse, .ng-caret { animation: none !important; transition: none !important; }
}
`;
