"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  EyeOff,
  LocateFixed,
  MapPin,
  PencilLine,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useAppUser } from "@/lib/auth/permission-context";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDateTime } from "@/lib/format";
import { findSimilar, joinTicket } from "@/lib/resolve/actions";
import { kbFeedback, searchKnowledgeBase } from "@/lib/resolve/desk-actions";
import { submitAssist } from "@/lib/resolve/assist-actions";
import type { SimilarTicket } from "@/lib/resolve/types";
import type { KbSearchHit } from "@/lib/resolve/desk-types";
import {
  NEEDED_BY,
  NEEDED_BY_LABEL,
  RQ_REASONS,
  RQ_REASON_LABEL,
  type AssistArea,
  type AssistItem,
  type AssistLane,
  type AssistReceipt,
  type NeededBy,
  type RqReason,
} from "@/lib/resolve/assist-types";
import { PhotoCapture, type CapturedPhoto } from "@/components/resolve/report/photo-capture";
import { SimilarReports } from "@/components/resolve/report/similar-reports";
import type { ReportPlaceOption } from "@/components/resolve/report/broken-report-form";
import { AnonymousReceipt } from "@/components/resolve/complaint/anonymous-receipt";
import { KbSteps } from "@/components/resolve/kb/kb-steps";
import {
  ANSWER_BAR,
  AssistHeader,
  Bot,
  CHAT_BOX_ID,
  Chip,
  Chips,
  Me,
  PRIMARY_LINK,
  ReviewRow,
  ROUTE_LOOK,
  softLabel,
} from "./assist";
import { assistIcon, searchCatalog } from "./assist-icons";
import { AssistBuddy, type BuddyMood } from "./assist-buddy";
import { AssistBackContext } from "./assist-back";

type Impact = "cannot_work" | "degraded" | "request";
const LANES: AssistLane[] = ["fix", "it", "buy", "concern"];
const OTHER = "__other__";
const SHOW_ITEMS = 6;
const SHOW_PLACES = 6;

/** The chat box on each question that can be answered by typing; on any
 *  other it stays in place, switched off, saying to tap a choice. */
const BOX: Partial<Record<Step, { hint: string; max: number }>> = {
  lane: { hint: "Type your problem — needle, printer, salary", max: 80 },
  area: { hint: "Type your problem — needle, printer, salary", max: 80 },
  item: { hint: "Type your problem — needle, printer, salary", max: 80 },
  custom: { hint: "Say it in a few words", max: 120 },
  detail: { hint: "Or type it in your own words", max: 200 },
  place: { hint: "Type the place — building, floor, line, machine", max: 120 },
  qty: { hint: "Or type how many", max: 9 },
  note: { hint: "Type a note, or tap No", max: 2000 },
};
const QTY_CHIPS = [1, 2, 5, 10, 25, 50];
const IMPACTS: { value: Impact; label: string; sub: string; tile: string }[] = [
  { value: "cannot_work", label: "I can't work at all", sub: "Everything is stopped", tile: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300" },
  { value: "degraded", label: "Working, with difficulty", sub: "Slower, or a workaround", tile: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
  { value: "request", label: "Just a request", sub: "Nothing is broken", tile: "bg-surface-muted text-foreground" },
];

type Step =
  | "lane" | "area" | "item" | "custom" | "detail" | "kb" | "place" | "similar" | "danger"
  | "impact" | "qty" | "needed" | "reason" | "superior" | "anon" | "photo" | "note"
  | "review" | "sent" | "fixed";

/** Everything answered so far. `null` = not asked yet; "" = skipped. */
type State = {
  step: Step;
  lane: AssistLane | null;
  areaId: string | null;
  itemId: string | null; // OTHER = "Something else"
  custom: string | null;
  detail: string | null;
  kbHits: KbSearchHit[] | null;
  kbDone: boolean;
  placeId: string | null;
  placeText: string | null;
  similar: SimilarTicket[] | null;
  similarAt: number;
  similarDone: boolean;
  danger: boolean | null;
  impact: Impact | null;
  qty: number | null;
  neededBy: NeededBy | null;
  reason: RqReason | null;
  superior: boolean | null;
  anonymous: boolean | null;
  /** The chosen concern's category accepts anonymous complaints (0751 catalog flag). */
  anonOk: boolean;
  photoDone: boolean;
  noteAsked: boolean;
};

const EMPTY: Omit<State, "step" | "lane"> = {
  areaId: null, itemId: null, custom: null, detail: null, kbHits: null, kbDone: false,
  placeId: null, placeText: null, similar: null, similarAt: 0, similarDone: false, danger: null,
  impact: null, qty: null, neededBy: null, reason: null, superior: null, anonymous: null, anonOk: false,
  photoDone: false, noteAsked: false,
};

/**
 * RAAGAM ASSIST — the ONE chat for everything a person raises (plan:
 * doc/resolve/assist-catalog-plan.md, user 2026-10-26 "one unified chat mode
 * … tapping with pre-built options"). It replaces the four separate chats.
 *
 * Every lane runs the same beats — lane → area → problem (the subject) →
 * what happened (a chip) → the ONE question that lane needs → photo where it
 * helps → review → send — and the only typing is "Something else" and
 * "Add a note". The catalog item already knows its team / IT category /
 * complaint category, so routing words never reach the reporter.
 *
 * THE STEP IS DERIVED, never pushed: `nextStep()` returns the first question
 * still unanswered for the lane. "Change" on the review clears that answer
 * and the chat walks back to it, then straight on to the review again — one
 * rule for every lane instead of a back-button per beat.
 */
export function AssistChat({
  areas,
  places,
  canReport,
  replyMinutes,
  emergencyContact,
  startLane = null,
}: {
  areas: AssistArea[];
  places: ReportPlaceOption[];
  canReport: boolean;
  replyMinutes: number;
  emergencyContact: string | null;
  /** A lane's own page (sidebar) starts there instead of asking. */
  startLane?: AssistLane | null;
}) {
  const router = useRouter();
  const { fullName } = useAppUser();
  const firstName = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const { error: toastError, success } = useToast();
  const [isPending, startTransition] = useTransition();

  const [s, setS] = useState<State>(() => {
    const init: State = { ...EMPTY, lane: startLane, step: "lane" };
    return { ...init, step: nextStep(init) };
  });
  /** What is in the chat box — a search on the first three questions, the
   *  person's own words on the rest. One box, so one value. */
  const [draft, setDraft] = useState("");
  /** Every state before an answer, newest last — "Change" pops one. */
  const [history, setHistory] = useState<State[]>([]);
  const [moreItems, setMoreItems] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AssistReceipt | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const laneAreas = useMemo(() => areas.filter((a) => a.lane === s.lane), [areas, s.lane]);
  const area = areas.find((a) => a.id === s.areaId) ?? null;
  const item: AssistItem | null = area?.items.find((i) => i.id === s.itemId) ?? null;
  const subject = s.itemId === OTHER ? (s.custom ?? "") : (item?.label ?? "");
  const dangerous = !!item?.dangerous || s.danger === true;
  const place = places.find((p) => p.id === s.placeId) ?? null;
  const look = s.lane ? ROUTE_LOOK[s.lane] : null;
  const searching = s.step === "lane" || s.step === "area" || s.step === "item";
  const hits = useMemo(
    () => (searching ? searchCatalog(s.lane ? laneAreas : areas, draft) : []),
    [areas, laneAreas, draft, s.lane, searching],
  );
  const shownPlaces = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const list = q ? places.filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q)) : places;
    return list.slice(0, SHOW_PLACES);
  }, [places, draft]);
  const box = BOX[s.step];
  const boxOn = !!box && !isPending;
  // The questions answered by typing take the cursor to the box; the rest
  // put it on their first choice, so a phone's keyboard opens only when
  // there is something to type.
  const typeFirst = s.step === "custom" || s.step === "note" || (s.step === "place" && places.length === 0);

  const dirty = s.lane !== null && s.step !== "sent" && s.step !== "fixed" && s.lane !== startLane;
  // The one-time anonymous link must survive a silent deploy reload.
  useUnsavedGuard(dirty || isPending || tracking !== null || (s.step === "review" && s.lane !== null));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    if (typeFirst) {
      document.getElementById(CHAT_BOX_ID)?.focus({ preventScroll: true });
      return;
    }
    const rows = logRef.current?.querySelectorAll("[data-assist-chips]");
    rows?.[rows.length - 1]?.querySelector<HTMLElement>("[data-assist-chip]")?.focus({ preventScroll: true });
  }, [s.step, typeFirst]);

  /** Merge answers, then walk to the first open question (unless told where). */
  function answer(patch: Partial<State>) {
    setHistory((h) => [...h, s]);
    setS((prev) => {
      const n = { ...prev, ...patch } as State;
      return { ...n, step: patch.step ?? nextStep(n) };
    });
    setDraft("");
    setMoreItems(false);
  }
  /** "Change" on the newest answer: the chat exactly as it was before it. */
  function back() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setS(prev);
    setDraft("");
    setMoreItems(false);
  }
  const canBack = history.length > 0 && !isPending && s.step !== "sent" && s.step !== "fixed";
  function focusBox() {
    document.getElementById(CHAT_BOX_ID)?.focus();
  }
  /** Send what is in the box, as the answer to whichever question is open. */
  function sendBox() {
    const t = draft.trim();
    if (!t || !boxOn) return;
    switch (s.step) {
      case "lane":
      case "area":
      case "item":
        if (hits.length > 0) return pickItem(hits[0].area, hits[0].item);
        if (!s.lane) return; // nothing to file it under yet — the line above the box says so
        return answer({
          areaId: area?.id ?? OTHER,
          itemId: OTHER,
          custom: t.toUpperCase(),
          detail: null,
          kbHits: null,
          kbDone: false,
          anonOk: false,
          anonymous: false,
        });
      case "custom":
        return answer({ custom: t.toUpperCase() });
      case "detail":
        return answer({ detail: t.toUpperCase() });
      case "place":
        if (shownPlaces.length === 1) return pickPlace(shownPlaces[0].id);
        return answer({ placeId: null, placeText: t.toUpperCase(), similar: [], similarDone: true });
      case "qty": {
        const n = Number(t);
        if (n > 0) answer({ qty: n });
        return;
      }
      case "note":
        setNote(t.toUpperCase());
        return answer({ noteAsked: true, step: "review" });
    }
  }

  function pickLane(lane: AssistLane) {
    answer({ ...EMPTY, lane });
  }
  function pickItem(a: AssistArea, i: AssistItem | null) {
    // A search hit may sit in another lane: switching lanes clears that lane's answers.
    const base: Partial<State> = s.lane === a.lane ? {} : { ...EMPTY, lane: a.lane };
    answer({
      ...base,
      areaId: a.id,
      itemId: i ? i.id : OTHER,
      custom: null,
      detail: null,
      kbHits: null,
      kbDone: false,
      anonOk: !!i?.anonymous_ok,
      anonymous: i?.anonymous_ok ? null : false,
    });
    // IT: look for a self-help article while they answer "what happened".
    if (a.lane === "it" && i) {
      void searchKnowledgeBase(i.label, null).then((res) =>
        setS((prev) => (prev.itemId === i.id ? { ...prev, kbHits: res.ok ? res.data.slice(0, 1) : [] } : prev)),
      );
    }
  }
  /** "Something else" before any area: the person says it in their own words,
   *  and the ticket goes to the lane's sorting queue (no catalog item). */
  function pickOther() {
    answer({ areaId: OTHER, itemId: OTHER, custom: null, detail: null, kbHits: null, kbDone: false, anonOk: false, anonymous: false });
  }
  function pickPlace(id: string) {
    if (!id) return;
    answer({ placeId: id, placeText: null, similar: null, similarDone: false, step: "place" });
    startTransition(async () => {
      const res = await findSimilar(id);
      setS((prev) => {
        if (prev.placeId !== id) return prev;
        const n = { ...prev, similar: res.ok ? res.data : [], similarAt: Date.now() };
        return { ...n, step: nextStep(n) };
      });
    });
  }
  function join(id: string) {
    setJoiningId(id);
    startTransition(async () => {
      const res = await joinTicket(id);
      if (!res.ok) {
        setJoiningId(null);
        toastError(res.error);
        return;
      }
      success("You have joined this report. You will be told when it is fixed.");
      router.push(`/resolve/tickets/${id}`);
    });
  }
  function attachLocation() {
    setGpsNote(null);
    if (!navigator.geolocation) return setGpsNote("This device cannot share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setGps({ lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lng: Math.round(pos.coords.longitude * 1e4) / 1e4 });
      },
      () => {
        setLocating(false);
        setGpsNote("Location was not shared — the report works without it.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  function restart(lane: AssistLane | null = null) {
    setS({ ...EMPTY, lane, step: lane ? "area" : "lane" });
    setHistory([]);
    setDraft("");
    setNote("");
    setPhoto(null);
    setGps(null);
    setReceipt(null);
    setTracking(null);
    setServerError(null);
  }

  function submit() {
    if (!s.lane) return;
    const fd = new FormData();
    fd.set("lane", s.lane);
    fd.set("item_id", s.itemId && s.itemId !== OTHER ? s.itemId : "");
    fd.set("title", s.itemId === OTHER ? (s.custom ?? "") : "");
    fd.set("detail", s.detail ?? "");
    fd.set("note", note.trim());
    fd.set("place_id", s.placeId ?? "");
    fd.set("place_text", s.placeText ?? "");
    fd.set("dangerous", dangerous ? "true" : "false");
    fd.set("gps_lat", gps ? String(gps.lat) : "");
    fd.set("gps_lng", gps ? String(gps.lng) : "");
    fd.set("impact", s.impact ?? "");
    fd.set("qty", s.qty ? String(s.qty) : "");
    fd.set("needed_by", s.neededBy ?? "");
    fd.set("reason", s.reason ?? "");
    fd.set("anonymous", s.anonymous ? "true" : "false");
    fd.set("about_superior", s.superior ? "true" : "false");
    if (photo && (s.lane === "fix" || s.lane === "it")) fd.set("photo", photo.file);
    setServerError(null);
    startTransition(async () => {
      const res = await submitAssist(fd);
      if (!res.ok) {
        setServerError(res.error);
        toastError(res.error);
        return;
      }
      setReceipt(res.data);
      // Built in the browser from where the person is now — never routed
      // through a URL of this app, so it cannot land in history or logs.
      if (res.data.tracking_token) setTracking(`${window.location.origin}/p/track/${res.data.tracking_token}`);
      answer({ step: "sent" });
    });
  }

  // ── Nool's mood — read off the chat, never stored ─────────────────────────
  // Order matters: a send in flight outranks everything, and danger outranks
  // typing (a worker describing a live wire should see "careful", not "listening").
  const mood: BuddyMood = isPending
    ? "thinking"
    : s.step === "sent" || s.step === "fixed"
      ? "happy"
      : s.step === "danger" || (dangerous && s.lane === "fix")
        ? "worried"
        : draft.trim()
          ? "listening"
          : "idle";

  // ── The conversation so far ────────────────────────────────────────────────
  const at = (step: Step) => s.step === step;
  const shownItems = area ? (moreItems ? area.items : area.items.slice(0, SHOW_ITEMS)) : [];

  if (!canReport) {
    return (
      <Frame lane={null} replyMinutes={replyMinutes} mood="worried">
        <div className="flex flex-col gap-3 px-3.5 py-4">
          <Bot>
            Hi{firstName ? ` ${firstName}` : ""}. Your login doesn&apos;t have access to Help &amp; Repairs yet, so I can&apos;t
            send anything for you. Ask your administrator to give you a role — until then, tell your supervisor.
          </Bot>
        </div>
      </Frame>
    );
  }

  return (
    <Frame lane={s.lane} replyMinutes={replyMinutes} mood={mood}>
      <AssistBackContext.Provider value={canBack ? back : null}>
      <div
        ref={logRef}
        className="flex min-h-[40dvh] flex-col gap-2.5 px-3.5 pt-3.5 pb-3 md:min-h-0 md:flex-1 md:overflow-y-auto"
        aria-live="polite"
      >
        {/* Nool says hello before the first question; it scrolls away with
            the conversation, and the header's buddy carries on from there. */}
        <AssistBuddy size={72} className="mx-auto mb-1 text-foreground" />
        <Bot>
          Hi{firstName ? ` ${firstName}` : ""}! What do you need? Tap one — or search below.
        </Bot>
        {s.lane && look && <Me tone={s.lane}>{look.label}</Me>}

        {s.lane && <Bot>{AREA_Q[s.lane]}</Bot>}
        {s.areaId === OTHER && <Me tone={s.lane ?? undefined}>Something else</Me>}
        {area && <Me tone={s.lane ?? undefined}>{area.label}</Me>}

        {area && <Bot>Which one?</Bot>}
        {area && s.itemId && <Me tone={s.lane ?? undefined}>{s.itemId === OTHER ? "Something else" : softLabel(subject)}</Me>}

        {s.itemId === OTHER && <Bot>Say it in a few words.</Bot>}
        {s.itemId === OTHER && s.custom && <Me tone={s.lane ?? undefined}>{s.custom}</Me>}

        {dangerous && s.lane === "fix" && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
          >
            <TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" />
            <span>
              <b>Marked urgent</b> — whoever fixes it is alerted now and it is due today.{" "}
              {emergencyContact
                ? `If anyone is hurt or in danger right now, call ${emergencyContact} first.`
                : "If anyone is hurt or in danger right now, call your supervisor and the first-aider first."}
            </span>
          </div>
        )}

        {(s.detail !== null || at("detail")) && <Bot>{DETAIL_Q[s.lane ?? "fix"]}</Bot>}
        {s.detail && <Me tone={s.lane ?? undefined}>{s.detail}</Me>}

        {s.lane === "it" && s.kbHits && s.kbHits.length > 0 && (at("kb") || s.kbDone) && (
          <>
            <Bot>This usually fixes it. Want to try it first?</Bot>
            {s.kbHits.map((h) => (
              <div key={h.id} className="overflow-hidden rounded-xl border border-sky-200 bg-surface shadow-sm dark:border-sky-500/30">
                <div className="flex items-start gap-2.5 px-3 pt-2.5">
                  <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300">
                    <BookOpen className="size-4" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold leading-5">{h.title}</span>
                    <span className="text-xs text-muted-foreground">{h.code}</span>
                  </span>
                </div>
                <div className="px-3 py-2.5">
                  <KbSteps steps={h.steps} />
                </div>
              </div>
            ))}
          </>
        )}
        {s.lane === "it" && s.kbDone && s.kbHits && s.kbHits.length > 0 && <Me tone="it">Still need help</Me>}

        {s.lane === "fix" && (s.placeId || s.placeText || at("place")) && <Bot>Where is it?</Bot>}
        {s.lane === "fix" && (s.placeId || s.placeText) && (
          <Me tone="fix">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden="true" />
              {place?.name ?? s.placeText}
            </span>
          </Me>
        )}
        {s.lane === "fix" && at("similar") && s.similar && (
          <>
            <Bot>This place already has open reports. If one is yours, join it — you&apos;ll be told when it&apos;s fixed.</Bot>
            <SimilarReports items={s.similar} checkedAtMs={s.similarAt} dangerous={dangerous} joiningId={joiningId} onJoin={join} />
          </>
        )}
        {s.lane === "fix" && s.similarDone && (s.similar?.length ?? 0) > 0 && <Me tone="fix">Mine is different</Me>}

        {s.lane === "fix" && s.itemId === OTHER && (s.danger !== null || at("danger")) && (
          <Bot>Could it hurt someone — a live wire, a gas smell, a loose shelf?</Bot>
        )}
        {s.lane === "fix" && s.danger !== null && (
          <Me tone="fix">{s.danger ? "Yes — it's dangerous" : "No"}</Me>
        )}

        {s.lane === "it" && (s.impact || at("impact")) && <Bot>How is it affecting your work?</Bot>}
        {s.lane === "it" && s.impact && <Me tone="it">{IMPACTS.find((o) => o.value === s.impact)?.label}</Me>}

        {s.lane === "buy" && (s.qty || at("qty")) && <Bot>How many?</Bot>}
        {s.lane === "buy" && s.qty && <Me tone="buy">{s.qty}</Me>}
        {s.lane === "buy" && (s.neededBy || at("needed")) && <Bot>When do you need it?</Bot>}
        {s.lane === "buy" && s.neededBy && <Me tone="buy">{NEEDED_BY_LABEL[s.neededBy]}</Me>}
        {s.lane === "buy" && (s.reason || at("reason")) && <Bot>Why is it needed?</Bot>}
        {s.lane === "buy" && s.reason && <Me tone="buy">{RQ_REASON_LABEL[s.reason]}</Me>}

        {s.lane === "concern" && item?.sensitive && s.itemId && (
          <Bot>
            This is a <b>sensitive</b> kind: only its named handler and committee can read it — not managers, not
            triage.
          </Bot>
        )}
        {s.lane === "concern" && (s.superior !== null || at("superior")) && <Bot>Is it about your own superior?</Bot>}
        {s.lane === "concern" && s.superior !== null && (
          <Me tone="concern">{s.superior ? "Yes, it's about my superior" : "No"}</Me>
        )}
        {s.lane === "concern" && s.superior && (
          <Bot>Then it goes to a handler outside your reporting line. Your manager and anyone above them will not see it.</Bot>
        )}
        {s.lane === "concern" && s.anonOk && (s.anonymous !== null || at("anon")) && (
          <Bot>Send it with your name, or anonymously?</Bot>
        )}
        {s.lane === "concern" && s.anonOk && s.anonymous !== null && (
          <Me tone="concern">{s.anonymous ? "Anonymously" : "With my name"}</Me>
        )}

        {(s.lane === "fix" || s.lane === "it") && (s.photoDone || at("photo")) && (
          <Bot>{s.lane === "fix" ? "A photo helps them bring the right tools. Add one?" : "A photo of the screen or error helps. Add one?"}</Bot>
        )}
        {(s.lane === "fix" || s.lane === "it") &&
          s.photoDone &&
          (photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview
            <img src={photo.url} alt="Your photo" className="h-28 w-40 self-end rounded-xl border border-border object-cover" />
          ) : (
            <Me tone={s.lane}>Skip</Me>
          ))}

        {at("note") && <Bot>Anything else they should know?</Bot>}

        {(at("review") || at("sent")) && s.lane && (
          <>
            <Bot>Here&apos;s what I&apos;ll send. Tap anything to change it.</Bot>
            <div className="flex flex-col rounded-xl border border-border bg-surface shadow-sm">
              <ReviewRow label="Problem" value={subject} onEdit={at("review") ? () => answer({ areaId: null, itemId: null, custom: null, detail: null, kbHits: null, kbDone: false }) : undefined} />
              {s.detail !== null && s.lane !== "buy" && (
                <ReviewRow label="What happened" value={s.detail || "—"} onEdit={at("review") ? () => answer({ detail: null }) : undefined} />
              )}
              {s.lane === "fix" && (
                <>
                  <ReviewRow label="Where" value={place?.name ?? s.placeText ?? "—"} onEdit={at("review") ? () => answer({ placeId: null, placeText: null, similar: null, similarDone: false }) : undefined} />
                  <ReviewRow
                    label="Dangerous"
                    plain
                    value={dangerous ? "Yes — urgent, due today" : "No"}
                    onEdit={at("review") && s.itemId === OTHER ? () => answer({ danger: null }) : undefined}
                  />
                  <ReviewRow
                    label="Location (optional)"
                    plain
                    value={gps ? `Attached (${gps.lat.toFixed(3)}, ${gps.lng.toFixed(3)})` : (gpsNote ?? "Not attached")}
                    onEdit={at("review") ? (gps ? () => setGps(null) : attachLocation) : undefined}
                  />
                </>
              )}
              {s.lane === "it" && (
                <ReviewRow label="Effect on work" plain value={IMPACTS.find((o) => o.value === s.impact)?.label ?? "—"} onEdit={at("review") ? () => answer({ impact: null }) : undefined} />
              )}
              {s.lane === "buy" && (
                <>
                  <ReviewRow label="How many" plain value={String(s.qty ?? "—")} onEdit={at("review") ? () => answer({ qty: null }) : undefined} />
                  <ReviewRow label="Needed by" plain value={s.neededBy ? NEEDED_BY_LABEL[s.neededBy] : "—"} onEdit={at("review") ? () => answer({ neededBy: null }) : undefined} />
                  <ReviewRow label="Why" plain value={s.reason ? RQ_REASON_LABEL[s.reason] : "—"} onEdit={at("review") ? () => answer({ reason: null }) : undefined} />
                </>
              )}
              {s.lane === "concern" && (
                <>
                  <ReviewRow label="About my superior" plain value={s.superior ? "Yes" : "No"} onEdit={at("review") ? () => answer({ superior: null }) : undefined} />
                  {s.anonOk && (
                    <ReviewRow label="Sent as" plain value={s.anonymous ? "Anonymous — no name kept" : "With my name"} onEdit={at("review") ? () => answer({ anonymous: null }) : undefined} />
                  )}
                </>
              )}
              {(s.lane === "fix" || s.lane === "it") && (
                <ReviewRow label="Photo" plain value={photo ? "1 photo attached" : "None"} onEdit={at("review") ? () => answer({ photoDone: false }) : undefined} />
              )}
              <ReviewRow label="Note (optional)" value={note.trim() || "—"} onEdit={at("review") ? () => answer({ step: "note" }) : undefined} />
            </div>
            {s.lane === "concern" && (
              <p className="rounded-xl border border-border bg-surface-muted/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                {s.anonymous
                  ? "Anonymous: your name is not stored anywhere, so nobody can see who sent it. You get a private link once to follow it — keep it safe."
                  : "With your name: the person looking into it can reply to you, and you can follow it under My Reports."}{" "}
                {s.superior || item?.sensitive
                  ? "Only the person looking into it" + (s.superior ? "" : " and a small committee") + " can read it."
                  : "The person looking into it and your unit's managers can read it."}
              </p>
            )}
          </>
        )}

        {serverError && at("review") && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        )}

        {at("fixed") && (
          <>
            <Me tone="it">This fixed it</Me>
            <Bot>Glad it&apos;s working. No request was raised, so nobody will chase you about it.</Bot>
          </>
        )}

        {at("sent") && receipt && !tracking && <Receipt r={receipt} />}
        {at("sent") && receipt && tracking && (
          <AnonymousReceipt
            refNo={receipt.ref_no}
            trackingUrl={tracking}
            responseDueAt={receipt.response_due_at}
            onDone={() => {
              setTracking(null);
              restart();
            }}
          />
        )}

        {/* ── The choices for the current question — right under it ──────── */}
        {at("lane") && (
          <Chips label="What do you need">
            {LANES.map((k) => {
              const r = ROUTE_LOOK[k];
              return <Chip key={k} label={r.label} sub={r.sub} icon={r.icon} tile={r.tile} ring={r.ring} onClick={() => pickLane(k)} />;
            })}
          </Chips>
        )}

        {at("area") && (
          <Chips>
            {laneAreas.map((a) => (
              <Chip
                key={a.id}
                label={a.label}
                icon={assistIcon(a.icon)}
                tile={look?.tile}
                ring={look?.ring}
                onClick={() => answer({ areaId: a.id, itemId: null })}
              />
            ))}
            <Chip label="Something else" icon={PencilLine} onClick={pickOther} />
          </Chips>
        )}

        {at("item") && area && (
          <Chips>
            {shownItems.map((i) => (
              <Chip key={i.id} label={softLabel(i.label)} danger={i.dangerous} ring={look?.ring} onClick={() => pickItem(area, i)} />
            ))}
            {area.items.length > SHOW_ITEMS && !moreItems && (
              <Chip label={`More (${area.items.length - SHOW_ITEMS})`} onClick={() => setMoreItems(true)} />
            )}
            <Chip label="Something else" icon={PencilLine} onClick={() => pickItem(area, null)} />
          </Chips>
        )}

        {/* Typing in the box searches the whole catalog; the matches answer
            the same question the chips above do. */}
        {searching && draft.trim().length >= 2 &&
          (hits.length === 0 ? (
            <p className="pl-[34px] text-xs text-muted-foreground">
              {s.lane
                ? "Nothing matches — pick a choice, or press Send to say it in your own words."
                : "Nothing matches — pick what kind of help first."}
            </p>
          ) : (
            <Chips label="Matches" instant>
              {hits.map(({ area: a, item: i }) => (
                <Chip
                  key={i.id}
                  label={softLabel(i.label)}
                  sub={`${ROUTE_LOOK[a.lane].label} · ${a.label}`}
                  icon={assistIcon(a.icon)}
                  tile={ROUTE_LOOK[a.lane].tile}
                  danger={i.dangerous}
                  onClick={() => pickItem(a, i)}
                />
              ))}
            </Chips>
          ))}

        {at("detail") && (
          <Chips>
            {(item?.details.length ? item.details : area?.items[0]?.details ?? DETAIL_FALLBACK[s.lane ?? "fix"]).map((d) => (
              <Chip key={d} label={d} ring={look?.ring} onClick={() => answer({ detail: d.toUpperCase() })} />
            ))}
            <Chip label="Type it" icon={PencilLine} onClick={focusBox} />
            <Chip label="Skip" onClick={() => answer({ detail: "" })} />
          </Chips>
        )}

        {at("kb") && s.kbHits?.[0] && (
          <Chips>
            <Chip
              label="This fixed it"
              icon={Check}
              tile={ROUTE_LOOK.it.tile}
              onClick={() => {
                void kbFeedback(s.kbHits![0].id, true);
                answer({ step: "fixed" });
              }}
            />
            <Chip label="Still need help" onClick={() => answer({ kbDone: true })} />
          </Chips>
        )}

        {/* A list in the chat, narrowed by what is typed in the box; Send
            with a name that is not on it keeps the words as the place. */}
        {at("place") && !s.placeId && (
          <div
            role="group"
            aria-label="Places"
            data-assist-chips
            className="ml-[34px] flex max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm motion-safe:animate-[rise_0.3s_ease_0.45s_both]"
          >
            <span className="px-3 py-2 text-xs text-muted-foreground">
              {places.length > 0
                ? "Pick the place, or type it below if it isn't listed"
                : "Type it below — building, floor, line, machine"}
            </span>
            {shownPlaces.map((p) => (
              // button-shape: exempt -- a row of the place list, not an action button
              <button
                key={p.id}
                type="button"
                data-assist-chip
                onClick={() => pickPlace(p.id)}
                className="flex min-h-10 items-center gap-2.5 border-t border-border px-3 py-1.5 text-left text-[13.5px] font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <MapPin className="size-4 flex-none text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">{p.name}</span>
                {p.code && <span className="text-xs tabular-nums text-muted-foreground">{p.code}</span>}
              </button>
            ))}
          </div>
        )}

        {at("similar") && (
          <Chips>
            <Chip label="Mine is different — carry on" onClick={() => answer({ similarDone: true })} disabled={joiningId !== null} />
          </Chips>
        )}

        {at("danger") && (
          <Chips>
            <Chip label="Yes — it's dangerous" sub="Alert them now" danger onClick={() => answer({ danger: true })} />
            <Chip label="No" sub="Ordinary repair" icon={ShieldCheck} onClick={() => answer({ danger: false })} />
          </Chips>
        )}

        {at("impact") && (
          <Chips>
            {IMPACTS.map((o) => (
              <Chip key={o.value} label={o.label} sub={o.sub} icon={TriangleAlert} tile={o.tile} onClick={() => answer({ impact: o.value })} />
            ))}
          </Chips>
        )}

        {at("qty") && (
          <Chips>
            {QTY_CHIPS.map((n) => (
              <Chip key={n} label={String(n)} ring={look?.ring} onClick={() => answer({ qty: n })} />
            ))}
            <Chip label="Other" icon={PencilLine} onClick={focusBox} />
          </Chips>
        )}

        {at("needed") && (
          <Chips>
            {NEEDED_BY.map((k) => (
              <Chip key={k} label={NEEDED_BY_LABEL[k]} ring={look?.ring} onClick={() => answer({ neededBy: k })} />
            ))}
          </Chips>
        )}

        {at("reason") && (
          <Chips>
            {RQ_REASONS.map((k) => (
              <Chip key={k} label={RQ_REASON_LABEL[k]} ring={look?.ring} onClick={() => answer({ reason: k })} />
            ))}
          </Chips>
        )}

        {at("superior") && (
          <Chips>
            <Chip label="Yes" sub="Keep it away from my reporting line" icon={ShieldCheck} tile={ROUTE_LOOK.concern.tile} onClick={() => answer({ superior: true })} />
            <Chip label="No" sub="Someone else, or a situation" icon={Users} onClick={() => answer({ superior: false })} />
          </Chips>
        )}

        {at("anon") && (
          <Chips>
            <Chip label="With my name" sub="The handler can reply to me" icon={UserRound} tile={ROUTE_LOOK.concern.tile} onClick={() => answer({ anonymous: false })} />
            <Chip
              label="Anonymously"
              sub="No name kept; a private tracking link once"
              icon={EyeOff}
              tile="bg-slate-200 text-slate-800 dark:bg-slate-400/15 dark:text-slate-200"
              onClick={() => answer({ anonymous: true })}
            />
          </Chips>
        )}

        {at("photo") && (
          <Chips label="Photo">
            <PhotoCapture
              value={photo}
              onChange={(p) => {
                if (!p) return;
                setPhoto(p);
                answer({ photoDone: true });
              }}
              takeLabel="Add photo"
            />
            <Chip label="Skip" onClick={() => answer({ photoDone: true })} />
          </Chips>
        )}

        {at("note") && (
          <Chips>
            <Chip label={note.trim() ? "Keep my note" : "No, that's all"} onClick={() => answer({ noteAsked: true, step: "review" })} />
          </Chips>
        )}

        {at("review") && (
          <Chips label="Send">
            {s.lane === "fix" && !gps && (
              <Chip
                label={locating ? "Finding you…" : "Attach my location (optional)"}
                icon={LocateFixed}
                onClick={attachLocation}
                disabled={locating}
              />
            )}
            <Button type="button" data-assist-chip onClick={submit} disabled={isPending}>
              {isPending ? "Sending…" : SEND_LABEL(s.lane, dangerous, s.anonymous === true)}
            </Button>
          </Chips>
        )}

        {at("sent") && receipt && !tracking && (
          <Chips label="What next">
            {receipt.ticket_id && (
              <Link href={`/resolve/tickets/${receipt.ticket_id}`} data-assist-chip className={PRIMARY_LINK}>
                Open it <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            )}
            <Chip label="Something else" icon={PencilLine} onClick={() => restart()} />
          </Chips>
        )}

        {at("fixed") && (
          <Chips>
            <Chip label="Ask about something else" onClick={() => restart()} />
          </Chips>
        )}

        <div ref={endRef} />
      </div>
      </AssistBackContext.Provider>

      {/* ── One chat box, the same on every step ─────────────────────────── */}
      <div className={ANSWER_BAR}>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendBox();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            {/* caps-input: exempt -- one chat box for a search query and free text; every answer it stores is upper-cased on send */}
            <Input
              id={CHAT_BOX_ID}
              value={draft}
              uppercase={false}
              disabled={!boxOn}
              placeholder={box?.hint ?? "Tap a choice above"}
              aria-label={box?.hint ?? "Tap a choice above"}
              inputMode={at("qty") ? "numeric" : undefined}
              maxLength={box?.max}
              className="rounded-full pl-8"
              onChange={(e) => {
                setDraft(e.target.value);
                if (searching) requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
              }}
              onKeyDown={(e) => {
                // ↑ from an empty box steps up into the newest row of choices.
                if (e.key !== "ArrowUp" || draft) return;
                const rows = logRef.current?.querySelectorAll("[data-assist-chips]");
                const first = rows?.[rows.length - 1]?.querySelector<HTMLElement>("[data-assist-chip]");
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }}
            />
          </div>
          <Button type="submit" aria-label="Send" className="w-9 flex-none px-0" disabled={!boxOn || !draft.trim()}>
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>
      </div>
    </Frame>
  );
}

// ── The derived step ──────────────────────────────────────────────────────────

/** The first question the lane still needs answered. */
function nextStep(s: State): Step {
  if (s.step === "sent" || s.step === "fixed") return s.step;
  if (!s.lane) return "lane";
  if (!s.areaId) return "area";
  if (!s.itemId) return "item";
  if (s.itemId === OTHER && !s.custom) return "custom";
  if (s.lane !== "buy" && s.detail === null) return "detail";
  if (s.lane === "it" && s.kbHits && s.kbHits.length > 0 && !s.kbDone) return "kb";
  if (s.lane === "fix") {
    if (!s.placeId && !s.placeText) return "place";
    if (s.similar === null && s.placeId) return "place"; // still checking
    if ((s.similar?.length ?? 0) > 0 && !s.similarDone) return "similar";
    if (s.itemId === OTHER && s.danger === null) return "danger";
  }
  if (s.lane === "it" && !s.impact) return "impact";
  if (s.lane === "buy") {
    if (!s.qty) return "qty";
    if (!s.neededBy) return "needed";
    if (!s.reason) return "reason";
  }
  if (s.lane === "concern") {
    if (s.superior === null) return "superior";
    if (s.anonOk && s.anonymous === null) return "anon";
  }
  if ((s.lane === "fix" || s.lane === "it") && !s.photoDone) return "photo";
  return "review";
}

const AREA_Q: Record<AssistLane, string> = {
  fix: "What needs fixing?",
  it: "What kind of IT problem?",
  buy: "What do you need?",
  concern: "What is it about? Only the people who handle it will see it.",
};
/** "What happened" choices when no catalog item supplies its own — the person
 *  picked "Something else" before choosing an area. */
const DETAIL_FALLBACK: Record<AssistLane, string[]> = {
  fix: ["Just started", "Since yesterday", "Keeps happening"],
  it: ["Just me", "My whole team", "Since today"],
  buy: [],
  concern: ["Happened once", "Keeps happening"],
};
const DETAIL_Q: Record<AssistLane, string> = {
  fix: "What's happening?",
  it: "Since when, and who's affected?",
  buy: "",
  concern: "How often?",
};
function SEND_LABEL(lane: AssistLane | null, dangerous: boolean, anonymous: boolean) {
  if (lane === "fix") return dangerous ? "Send urgent report" : "Send report";
  if (lane === "it") return "Send to IT desk";
  if (lane === "buy") return "Send request";
  return anonymous ? "Send anonymously" : "Send";
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Frame({
  lane,
  replyMinutes,
  mood,
  children,
}: {
  lane: AssistLane | null;
  replyMinutes: number;
  mood: BuddyMood;
  children: React.ReactNode;
}) {
  return (
    // One screen on a desktop: the conversation scrolls inside the frame and
    // the answers stay docked at its foot, so the page itself never scrolls.
    <section
      aria-label="Raagam Assist"
      className="flex w-full flex-col border-border bg-background md:h-[calc(100dvh-10.5rem)] md:min-h-[30rem] md:rounded-2xl md:border md:shadow-sm"
    >
      <AssistHeader
        mood={mood}
        status={
          lane === "it"
            ? `IT desk replies in about ${replyMinutes} min`
            : lane === "concern"
              ? "Goes to an independent handler"
              : lane === "buy"
                ? "Goes to Stores"
                : "Goes straight to the right person"
        }
      />
      {children}
    </section>
  );
}

function Receipt({ r }: { r: AssistReceipt }) {
  const firstBy = r.lane === "it" || r.lane === "concern" ? r.response_due_at : null;
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-emerald-300 bg-surface p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-800">
          <Check className="size-4" aria-hidden="true" />
        </span>
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold">Sent — {r.ref_no}</span>
          <span className="text-xs text-muted-foreground">
            {r.needs_sorting ? "It will be passed to the right person shortly" : `${r.owner_name ?? "The right person"} has it`}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {firstBy && (
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground">First reply by</span>
            <span className="text-sm font-semibold">{fmtDateTime(firstBy)}</span>
          </div>
        )}
        {r.due_at && r.lane !== "concern" && (
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground">{r.lane === "buy" ? "Needed by" : "Due by"}</span>
            <span className="text-sm font-semibold">{fmtDateTime(r.due_at)}</span>
          </div>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">You&apos;ll get a notification as it moves. Follow it under My Reports.</p>
    </div>
  );
}
