"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  EyeOff,
  LocateFixed,
  MapPin,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
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
  AnswerCard,
  AssistHeader,
  Bot,
  Me,
  PRIMARY_LINK,
  ReviewRow,
  ROUTE_LOOK,
} from "./assist";
import { assistIcon, searchCatalog } from "./assist-icons";

type Impact = "cannot_work" | "degraded" | "request";
const LANES: AssistLane[] = ["fix", "it", "buy", "concern"];
const OTHER = "__other__";
const SHOW_ITEMS = 6;
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
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [moreItems, setMoreItems] = useState(false);
  const [typingPlace, setTypingPlace] = useState(places.length === 0);
  const [qtyTyping, setQtyTyping] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AssistReceipt | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const laneAreas = useMemo(() => areas.filter((a) => a.lane === s.lane), [areas, s.lane]);
  const area = areas.find((a) => a.id === s.areaId) ?? null;
  const item: AssistItem | null = area?.items.find((i) => i.id === s.itemId) ?? null;
  const subject = s.itemId === OTHER ? (s.custom ?? "") : (item?.label ?? "");
  const dangerous = !!item?.dangerous || s.danger === true;
  const place = places.find((p) => p.id === s.placeId) ?? null;
  const look = s.lane ? ROUTE_LOOK[s.lane] : null;
  const hits = useMemo(
    () => (["lane", "area", "item"].includes(s.step) ? searchCatalog(s.lane ? laneAreas : areas, query) : []),
    [areas, laneAreas, query, s.lane, s.step],
  );

  const dirty = s.lane !== null && s.step !== "sent" && s.step !== "fixed" && s.lane !== startLane;
  // The one-time anonymous link must survive a silent deploy reload.
  useUnsavedGuard(dirty || isPending || tracking !== null || (s.step === "review" && s.lane !== null));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    barRef.current?.querySelector<HTMLElement>("textarea, input:not([type=file]), button")?.focus();
  }, [s.step]);

  /** Merge answers, then walk to the first open question (unless told where). */
  function answer(patch: Partial<State>) {
    setS((prev) => {
      const n = { ...prev, ...patch } as State;
      return { ...n, step: patch.step ?? nextStep(n) };
    });
    setQuery("");
    setMoreItems(false);
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

  const placeOptions = useMemo<ComboboxOption[]>(
    () => places.map((p) => ({ value: p.id, label: p.name, search: p.code })),
    [places],
  );

  // ── The conversation so far ────────────────────────────────────────────────
  const at = (step: Step) => s.step === step;
  const shownItems = area ? (moreItems ? area.items : area.items.slice(0, SHOW_ITEMS)) : [];

  if (!canReport) {
    return (
      <Frame lane={null} replyMinutes={replyMinutes}>
        <div className="flex flex-col gap-3 px-3.5 py-4">
          <Bot>
            Hi{firstName ? ` ${firstName}` : ""}. Your login doesn&apos;t have access to Resolve Hub yet, so I can&apos;t
            send anything for you. Ask your administrator to give you a role — until then, tell your supervisor.
          </Bot>
        </div>
      </Frame>
    );
  }

  return (
    <Frame lane={s.lane} replyMinutes={replyMinutes}>
      <div className="flex min-h-[40dvh] flex-col gap-3 px-3.5 pt-4 pb-3" aria-live="polite">
        <Bot>
          Hi{firstName ? ` ${firstName}` : ""}! What do you need? Tap one — or search below.
        </Bot>
        {s.lane && look && <Me tone={s.lane}>{look.label}</Me>}

        {s.lane && <Bot>{AREA_Q[s.lane]}</Bot>}
        {area && <Me tone={s.lane ?? undefined}>{area.label}</Me>}

        {area && <Bot>Which one?</Bot>}
        {s.itemId && <Me tone={s.lane ?? undefined}>{s.itemId === OTHER ? "Something else" : subject}</Me>}

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
                  ? "Anonymous: your name is not stored anywhere, so the handler cannot see or contact you. You get a private tracking link once — keep it safe."
                  : "With your name: the handler can see who you are and reply, and you can follow it under My Complaints."}{" "}
                {s.superior || item?.sensitive
                  ? "Only the named handler" + (s.superior ? "" : " and its committee") + " can read it."
                  : "The handler for this kind and your unit's Resolve Hub managers can read it."}
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

        <div ref={endRef} />
      </div>

      {/* ── The answers for the current question ─────────────────────────── */}
      <div ref={barRef} className={ANSWER_BAR}>
        {at("lane") && (
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            {LANES.map((k) => {
              const r = ROUTE_LOOK[k];
              return <AnswerCard key={k} title={r.label} sub={r.sub} icon={r.icon} tile={r.tile} ring={r.ring} onClick={() => pickLane(k)} />;
            })}
          </div>
        )}

        {at("area") && (
          <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3">
            {laneAreas.map((a) => (
              <AnswerCard
                key={a.id}
                title={a.label}
                icon={assistIcon(a.icon)}
                tile={look?.tile}
                ring={look?.ring}
                onClick={() => answer({ areaId: a.id, itemId: null })}
              />
            ))}
          </div>
        )}

        {at("item") && area && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
              {shownItems.map((i) => (
                // button-shape: exempt -- a one-line answer row, not an action button
                <button
                  key={i.id}
                  type="button"
                  onClick={() => pickItem(area, i)}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm font-medium shadow-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring",
                    look?.ring,
                  )}
                >
                  {i.dangerous && <TriangleAlert className="size-4 flex-none text-red-600" aria-label="Dangerous" />}
                  <span className="uppercase">{i.label}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {area.items.length > SHOW_ITEMS && !moreItems && (
                <Button type="button" variant="outline" size="sm" onClick={() => setMoreItems(true)}>
                  More ({area.items.length - SHOW_ITEMS})
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => pickItem(area, null)}>
                Something else
              </Button>
            </div>
          </div>
        )}

        {(at("area") || at("item")) && (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => (at("item") ? answer({ areaId: null }) : restart())}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Back
          </Button>
        )}

        {/* One search over the catalog — the fastest way to any problem */}
        {(at("lane") || at("area") || at("item")) && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="assist-search" className="flex items-center gap-1.5 pl-0.5 text-xs font-medium text-muted-foreground">
              <Search className="size-3.5" aria-hidden="true" /> Search a problem — needle, printer, salary…
            </label>
            {/* caps-input: exempt -- a search query, not a stored value */}
            <Input id="assist-search" value={query} uppercase={false} type="search" onChange={(e) => setQuery(e.target.value)} />
            {query.trim().length >= 2 && (
              <div className="flex flex-col gap-1">
                {hits.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">Nothing matches — pick an area, or choose Something else.</p>
                ) : (
                  hits.map(({ area: a, item: i }) => (
                    // button-shape: exempt -- a search result row, not an action button
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => pickItem(a, i)}
                      className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className={cn("size-2 flex-none rounded-full", ROUTE_LOOK[a.lane].dot)} aria-hidden="true" />
                      <span className="flex flex-col">
                        <span className="text-sm font-medium uppercase">{i.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {ROUTE_LOOK[a.lane].label} · {a.label}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {at("custom") && (
          <TextAnswer
            id="assist-custom"
            label="In a few words"
            max={120}
            value={draft}
            onChange={setDraft}
            onSend={(t) => {
              setDraft("");
              answer({ custom: t.toUpperCase() });
            }}
          />
        )}

        {at("detail") && area && (
          <div className="flex flex-wrap gap-2">
            {(item?.details.length ? item.details : area.items[0]?.details ?? []).map((d) => (
              <Button key={d} type="button" variant="outline" size="sm" onClick={() => answer({ detail: d.toUpperCase() })}>
                {d}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => answer({ detail: "" })}>
              Skip
            </Button>
          </div>
        )}

        {at("kb") && s.kbHits?.[0] && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => {
                void kbFeedback(s.kbHits![0].id, true);
                answer({ step: "fixed" });
              }}
            >
              This fixed it
            </Button>
            <Button type="button" variant="outline" onClick={() => answer({ kbDone: true })}>
              Still need help
            </Button>
          </div>
        )}

        {at("place") &&
          (typingPlace ? (
            <div className="flex flex-col gap-1.5">
              <TextAnswer
                id="assist-place"
                label="Where is it? Building, floor, line, machine"
                max={120}
                value={draft}
                onChange={setDraft}
                onSend={(t) => {
                  setDraft("");
                  answer({ placeId: null, placeText: t.toUpperCase(), similar: [], similarDone: true });
                }}
              />
              {places.length > 0 && (
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setTypingPlace(false)}>
                  Pick from the list instead
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="pl-0.5 text-xs font-medium text-muted-foreground">Search the place</span>
              <Combobox options={placeOptions} value={s.placeId ?? ""} onChange={pickPlace} />
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setTypingPlace(true)}>
                My place isn&apos;t listed
              </Button>
            </div>
          ))}

        {at("similar") && (
          <Button type="button" variant="outline" onClick={() => answer({ similarDone: true })} disabled={joiningId !== null}>
            Mine is different — carry on
          </Button>
        )}

        {at("danger") && (
          <div className="grid grid-cols-2 gap-2">
            <AnswerCard
              title="Yes — it's dangerous"
              sub="Alert them now"
              icon={TriangleAlert}
              tile="bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300"
              onClick={() => answer({ danger: true })}
            />
            <AnswerCard title="No" sub="Ordinary repair" icon={ShieldCheck} onClick={() => answer({ danger: false })} />
          </div>
        )}

        {at("impact") && (
          <div className="flex flex-col gap-2">
            {IMPACTS.map((o) => (
              <AnswerCard key={o.value} title={o.label} sub={o.sub} icon={TriangleAlert} tile={o.tile} onClick={() => answer({ impact: o.value })} />
            ))}
          </div>
        )}

        {at("qty") &&
          (qtyTyping ? (
            <TextAnswer
              id="assist-qty"
              label="How many"
              type="number"
              max={9}
              value={draft}
              onChange={setDraft}
              onSend={(t) => {
                const n = Number(t);
                if (!(n > 0)) return;
                setDraft("");
                setQtyTyping(false);
                answer({ qty: n });
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {QTY_CHIPS.map((n) => (
                <Button key={n} type="button" variant="outline" size="sm" onClick={() => answer({ qty: n })}>
                  {n}
                </Button>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={() => setQtyTyping(true)}>
                Other
              </Button>
            </div>
          ))}

        {at("needed") && (
          <div className="flex flex-wrap gap-2">
            {NEEDED_BY.map((k) => (
              <Button key={k} type="button" variant="outline" size="sm" onClick={() => answer({ neededBy: k })}>
                {NEEDED_BY_LABEL[k]}
              </Button>
            ))}
          </div>
        )}

        {at("reason") && (
          <div className="flex flex-wrap gap-2">
            {RQ_REASONS.map((k) => (
              <Button key={k} type="button" variant="outline" size="sm" onClick={() => answer({ reason: k })}>
                {RQ_REASON_LABEL[k]}
              </Button>
            ))}
          </div>
        )}

        {at("superior") && (
          <div className="grid grid-cols-2 gap-2">
            <AnswerCard title="Yes" sub="Keep it away from my reporting line" icon={ShieldCheck} tile={ROUTE_LOOK.concern.tile} onClick={() => answer({ superior: true })} />
            <AnswerCard title="No" sub="Someone else, or a situation" icon={Users} onClick={() => answer({ superior: false })} />
          </div>
        )}

        {at("anon") && (
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <AnswerCard title="With my name" sub="The handler can reply to me" icon={UserRound} tile={ROUTE_LOOK.concern.tile} onClick={() => answer({ anonymous: false })} />
            <AnswerCard
              title="Anonymously"
              sub="No name kept; a private tracking link once"
              icon={EyeOff}
              tile="bg-slate-200 text-slate-800 dark:bg-slate-400/15 dark:text-slate-200"
              onClick={() => answer({ anonymous: true })}
            />
          </div>
        )}

        {at("photo") && (
          <div className="flex flex-col gap-2">
            <PhotoCapture
              value={photo}
              onChange={(p) => {
                if (!p) return;
                setPhoto(p);
                answer({ photoDone: true });
              }}
              takeLabel="Add photo"
            />
            <Button type="button" variant="outline" onClick={() => answer({ photoDone: true })}>
              Skip
            </Button>
          </div>
        )}

        {at("note") && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="assist-note" className="pl-0.5 text-xs font-medium text-muted-foreground">
              Note (optional)
            </label>
            <Textarea id="assist-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button type="button" onClick={() => answer({ noteAsked: true, step: "review" })}>
              Done
            </Button>
          </div>
        )}

        {at("review") && (
          <div className="flex flex-col gap-2">
            {s.lane === "fix" && !gps && (
              <Button type="button" variant="outline" onClick={attachLocation} disabled={locating}>
                <LocateFixed className="size-4" aria-hidden="true" />
                {locating ? "Finding you…" : "Attach my location (optional)"}
              </Button>
            )}
            <Button type="button" onClick={submit} disabled={isPending}>
              {isPending ? "Sending…" : SEND_LABEL(s.lane, dangerous, s.anonymous === true)}
            </Button>
          </div>
        )}

        {at("sent") && receipt && !tracking && (
          <div className="grid grid-cols-2 gap-2">
            {receipt.ticket_id ? (
              <Link href={`/resolve/tickets/${receipt.ticket_id}`} className={PRIMARY_LINK}>
                Open it <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
            <Button type="button" variant="outline" onClick={() => restart()}>
              Something else
            </Button>
          </div>
        )}

        {at("fixed") && (
          <Button type="button" variant="outline" onClick={() => restart()}>
            Ask about something else
          </Button>
        )}
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

function Frame({ lane, replyMinutes, children }: { lane: AssistLane | null; replyMinutes: number; children: React.ReactNode }) {
  return (
    <section aria-label="Raagam Assist" className="flex w-full flex-col border-border bg-background md:rounded-2xl md:border md:shadow-sm">
      <AssistHeader
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

function TextAnswer({
  id,
  label,
  value,
  onChange,
  onSend,
  max,
  type,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  max: number;
  type?: "number";
}) {
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSend(value.trim());
      }}
    >
      <label htmlFor={id} className="pl-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          value={value}
          maxLength={type === "number" ? undefined : max}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" aria-label="Send" disabled={!value.trim()}>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </form>
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
