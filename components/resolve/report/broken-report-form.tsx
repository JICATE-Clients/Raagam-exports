"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, MapPin, Send, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { findSimilar, joinTicket, submitBroken } from "@/lib/resolve/actions";
import type { SimilarTicket } from "@/lib/resolve/types";
import { PhotoCapture, type CapturedPhoto } from "./photo-capture";
import { SimilarReports } from "./similar-reports";

export type ReportPlaceOption = {
  id: string;
  code: string;
  name: string;
  default_trade_id: string | null;
};
export type ReportTradeOption = { id: string; name: string };

/** The place a QR sticker named — shown, not chosen. */
export type LockedPlace = {
  id: string;
  name: string;
  location_name: string;
  recent_90d: number;
};

const NOT_SURE = "";
/** "My place isn't listed" — the reporter types it instead (spec §4: chosen from
 *  the places list WHERE POSSIBLE). Never a dead end: with no places set up yet
 *  this is the only door, and the report still reaches someone (needs sorting). */
const OTHER_PLACE = "__other__";

/**
 * SOMETHING IS BROKEN — the quick report, phone first.
 *
 * One form for both doors: the chooser (`/resolve/report/broken`, place picked
 * here) and a QR sticker (`/r/<token>`, place fixed by the sticker and shown
 * read-only). Everything the reporter is NOT asked — severity, priority, who
 * owns it, when it is due — is decided by the server from the place, the trade
 * and the dangerous tick (plan §5), and comes back on the receipt.
 *
 * Location is attached only on an explicit tap, and is rounded to ~11 m by the
 * schema: it is for finding the spot, not tracking the person.
 */
export function BrokenReportForm({
  places,
  trades,
  lockedPlace = null,
  initialPlaceId = "",
  source,
  initialSimilar = [],
  initialCheckedAt = "",
}: {
  places: ReportPlaceOption[];
  trades: ReportTradeOption[];
  lockedPlace?: LockedPlace | null;
  initialPlaceId?: string;
  source: "form" | "qr";
  /** The open reports at a place that arrived pre-chosen (sticker, `?place=`),
   *  read by the page on the server — so the panel is there on first paint. */
  initialSimilar?: SimilarTicket[];
  /** The server clock when `initialSimilar` was read (ages are worded against it). */
  initialCheckedAt?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [isChecking, startChecking] = useTransition();

  const noPlaces = !lockedPlace && places.length === 0;
  const startPlace =
    lockedPlace?.id ??
    (places.some((p) => p.id === initialPlaceId) ? initialPlaceId : noPlaces ? OTHER_PLACE : "");
  const startTrade = places.find((p) => p.id === startPlace)?.default_trade_id ?? NOT_SURE;

  const [placeId, setPlaceId] = useState(startPlace);
  const [tradeId, setTradeId] = useState<string>(startTrade);
  const [tradeTouched, setTradeTouched] = useState(false);
  const [placeText, setPlaceText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dangerous, setDangerous] = useState(false);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [similar, setSimilar] = useState<SimilarTicket[]>(initialSimilar);
  const [similarAt, setSimilarAt] = useState(() => (initialCheckedAt ? new Date(initialCheckedAt).getTime() : 0));
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const similarFor = useRef<string>(startPlace);

  const dirty =
    !sent &&
    (title.trim() !== "" ||
      description.trim() !== "" ||
      placeText.trim() !== "" ||
      dangerous ||
      photo !== null ||
      gps !== null ||
      placeId !== startPlace ||
      tradeId !== startTrade);
  useUnsavedGuard(dirty || isPending);

  const placeOptions = useMemo<ComboboxOption[]>(
    () => [
      ...places.map((p) => ({ value: p.id, label: p.name, search: p.code })),
      { value: OTHER_PLACE, label: "My place isn't listed" },
    ],
    [places],
  );
  const tradeOptions = useMemo<ComboboxOption[]>(
    () => [{ value: NOT_SURE, label: "Not sure" }, ...trades.map((t) => ({ value: t.id, label: t.name }))],
    [trades],
  );

  function loadSimilar(id: string) {
    similarFor.current = id;
    if (!id) {
      setSimilar([]);
      return;
    }
    startChecking(async () => {
      const res = await findSimilar(id);
      // A newer pick may have overtaken this answer — keep the newest only.
      if (similarFor.current !== id) return;
      setSimilarAt(Date.now());
      setSimilar(res.ok ? res.data : []);
    });
  }

  function changePlace(id: string) {
    setPlaceId(id);
    if (!tradeTouched) {
      setTradeId(places.find((p) => p.id === id)?.default_trade_id ?? NOT_SURE);
    }
    // A typed place has no id, so there is nothing to compare reports against.
    loadSimilar(id === OTHER_PLACE ? "" : id);
  }

  function attachLocation() {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError("This device cannot share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setGps({
          lat: Math.round(pos.coords.latitude * 10_000) / 10_000,
          lng: Math.round(pos.coords.longitude * 10_000) / 10_000,
        });
      },
      () => {
        setLocating(false);
        setGpsError("Location was not shared. The report works without it.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
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
      setSent(true);
      success("You have joined this report. You will be told when it is fixed.");
      router.push(`/resolve/tickets/${id}`);
    });
  }

  const typedPlace = placeId === OTHER_PLACE;
  const placeMissing = !placeId;
  const placeTextMissing = typedPlace && !placeText.trim();
  const titleMissing = !title.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    if (placeMissing || placeTextMissing || titleMissing) return;
    const fd = new FormData();
    fd.set("place_id", typedPlace ? "" : placeId);
    fd.set("trade_id", tradeId);
    fd.set("title", title.trim());
    // The typed place travels in the description so whoever sorts it can read it.
    fd.set(
      "description",
      typedPlace
        ? [`PLACE: ${placeText.trim()}`, description.trim()].filter(Boolean).join("\n\n")
        : description.trim(),
    );
    fd.set("is_dangerous", dangerous ? "true" : "false");
    fd.set("gps_lat", gps ? String(gps.lat) : "");
    fd.set("gps_lng", gps ? String(gps.lng) : "");
    fd.set("source", source);
    if (photo) fd.set("photo", photo.file);
    startTransition(async () => {
      const res = await submitBroken(fd);
      if (!res.ok) {
        setServerError(res.error);
        toastError(res.error);
        return;
      }
      setSent(true);
      router.push(`/resolve/tickets/${res.data.ticket_id}?receipt=1`);
    });
  }

  const busy = isPending || sent;

  return (
    <form
      onSubmit={submit}
      // ONE MARKER, NEVER A HANDLER — makes this page form an editor scope, so
      // Tab walks its fields and Enter off the last one sends (keyboard contract).
      data-focus-scope
      className="w-full max-w-[40rem] space-y-4"
      /* 40rem: the 288px name step twice over plus the 12px gap, with room for
         the description to read as a paragraph. On a phone it is just the pane. */
    >
      {lockedPlace ? (
        <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MapPin className="h-4 w-4 text-primary" aria-hidden />
            {lockedPlace.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lockedPlace.location_name} · from the sticker you scanned
          </p>
          {lockedPlace.recent_90d >= 2 ? (
            <p className="mt-1 text-xs text-warning">
              {lockedPlace.recent_90d} reports here in the last 90 days.
            </p>
          ) : null}
        </div>
      ) : (
        <FieldRow align="start">
          {noPlaces ? null : (
            <Field
              label="Place"
              required
              w="name"
              error={attempted && placeMissing ? "Pick the place where the problem is." : undefined}
            >
              <Combobox options={placeOptions} value={placeId} onChange={changePlace} />
            </Field>
          )}
          {typedPlace ? (
            <Field
              label="Where is it?"
              required
              w="name"
              hint="Building, floor, room or machine — whatever helps someone find it."
              error={attempted && placeTextMissing ? "Say where the problem is." : undefined}
            >
              <Input value={placeText} maxLength={120} onChange={(e) => setPlaceText(e.target.value)} />
            </Field>
          ) : null}
        </FieldRow>
      )}

      {isChecking ? (
        <p className="text-xs text-muted-foreground">Checking for reports already made here…</p>
      ) : (
        <SimilarReports
          items={similar}
          checkedAtMs={similarAt}
          dangerous={dangerous}
          joiningId={joiningId}
          onJoin={join}
        />
      )}

      <FieldRow align="start">
        <Field
          label="What kind of problem"
          w="name"
          hint="Not sure is fine — it will be sorted for you."
        >
          <Combobox
            options={tradeOptions}
            value={tradeId}
            onChange={(v) => {
              setTradeTouched(true);
              setTradeId(v);
            }}
          />
        </Field>
      </FieldRow>

      {/* Unsized: outside a track a Field is a full-width block, which is the
          width a sentence and a paragraph want (the 40rem form cap bounds it). */}
      <Field
        label="What is wrong"
        required
        error={attempted && titleMissing ? "Say in a few words what is broken." : undefined}
      >
        <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <Field label="Details">
        <Textarea
          value={description}
          maxLength={2000}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="space-y-1">
        <Toggle checked={dangerous} onChange={setDangerous} label="This is dangerous / unsafe" />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          Marks it urgent: the owner is alerted straight away and it is due today. Use it for
          anything that could hurt someone.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Photo</p>
        <PhotoCapture value={photo} onChange={setPhoto} disabled={busy} />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Location</p>
        {gps ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <LocateFixed className="h-4 w-4 text-primary" aria-hidden />
              Attached ({gps.lat.toFixed(3)}, {gps.lng.toFixed(3)})
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setGps(null)} disabled={busy}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Remove
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={attachLocation} disabled={busy || locating}>
            <LocateFixed className="h-4 w-4" aria-hidden />
            {locating ? "Finding you…" : "Attach my location"}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Optional. Shared only with whoever fixes this, to help them find the spot.
        </p>
        {gpsError ? <p className="text-xs text-warning">{gpsError}</p> : null}
      </div>

      {serverError ? <FieldError>{serverError}</FieldError> : null}

      <div className="flex justify-end border-t border-border pt-3">
        <Button type="submit" disabled={busy}>
          <Send className="h-4 w-4" aria-hidden />
          {isPending && !joiningId ? "Sending…" : "Send report"}
        </Button>
      </div>
    </form>
  );
}
