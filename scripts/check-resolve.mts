/**
 * check:resolve — the pure halves of Resolve Hub (doc/resolve/resolve-hub-plan.md),
 * tested without a database:
 *
 *   1. JPEG — a photo's EXIF / GPS / comment segments and any trailer after
 *      the image are gone, the image itself is byte-for-byte intact, and
 *      anything that is not a complete JPEG is refused.
 *   2. CSV — RFC 4180 quoting, CRLF rows, formula-injection guard.
 *   3. SLA wording and the ticket status tones.
 *   4. Alerts — every resolve.* event in the registry has wording, and none
 *      without one; the permission map spells real, distinct actions.
 *   5. Schemas — CAPITALS applied in the schema, coordinates rounded.
 *   8. Service Desk — impact → priority, the two SLA clocks, SD / KB refs,
 *      and the wording of every desk alert.
 *
 * The RLS / transition half is scripts/resolve-smoke-test.sql (DB lane).
 */
import { inspectJpeg, stripJpegMetadata, MAX_PHOTO_BYTES } from "../lib/resolve/jpeg";
import { csvField, toCsv } from "../lib/resolve/csv";
import {
  clockWords,
  daysLate,
  dueWords,
  isLate,
  minutesLeft,
  resolutionState,
  responseState,
  SD_AT_RISK_SHARE,
  slaClockTone,
  spanWords,
  requirementStatusTone,
  ticketStatusTone,
} from "../lib/resolve/sla";
import { DEFAULT_SERVICE_SLA, IMPACTS, isServiceRef, KB_REF, priorityForImpact, SERVICE_REF } from "../lib/resolve/desk-types";
import { RESOLVE_MESSAGES, hidesSubject, isResolveEvent, istDateTime, resolveHref } from "../lib/resolve/messages";
import { hashTrackingToken, isTrackingToken, pickTracked, trackWith, withdrawWith, type TrackRpc } from "../lib/resolve/token";
import { randomBytes, createHash } from "node:crypto";
import { RH } from "../lib/resolve/permissions";
import { submitBrokenSchema, unitSettingsSchema } from "../lib/resolve/schemas";
import { NOTIFICATION_EVENTS } from "../lib/notifications/events";
import { ACTIONS } from "../lib/auth/types";

let failures = 0;
let passes = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  } else passes++;
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, "latin1"));
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

// ── 1. JPEG ─────────────────────────────────────────────────────────────────
const app0 = seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const app1 = seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPSLatitude 11.0168N GPSLongitude 76.9558E")]);
const xmp = seg(0xe2, ascii("ICC_PROFILE device-serial-XYZ"));
const com = seg(0xfe, ascii("Pixel 7 by REPORTER"));
const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
const sof0 = seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
const dht = seg(0xc4, [0, 1, ...new Array(15).fill(0), 0]);
const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
const entropy = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]; // stuffed FF00 + RST0
const eoi = [0xff, 0xd9];
const trailer = ascii("TRAILER-GPSLatitude");
const photo = new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...xmp, ...com, ...dqt, ...sof0, ...dht, ...sos, ...entropy, ...eoi, ...trailer]);
const expected = new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...sof0, ...dht, ...sos, ...entropy, ...eoi]);

eq("vector is a JPEG", inspectJpeg(photo).ok, true);
const clean = stripJpegMetadata(photo);
eq("strip: exact expected bytes", Buffer.from(clean).equals(Buffer.from(expected)), true);
eq("strip: starts FF D8 FF", [clean[0], clean[1], clean[2]], [0xff, 0xd8, 0xff]);
eq("strip: ends FF D9", [clean[clean.length - 2], clean[clean.length - 1]], [0xff, 0xd9]);
eq("strip: keeps SOS", Buffer.from(clean).includes(Buffer.from([0xff, 0xda])), true);
eq("strip: keeps JFIF (APP0)", has(clean, "JFIF"), true);
eq("strip: drops Exif (APP1)", has(clean, "Exif"), false);
eq("strip: drops GPS", has(clean, "GPSLatitude"), false);
eq("strip: drops APP2", has(clean, "device-serial"), false);
eq("strip: drops COM", has(clean, "REPORTER"), false);
eq("strip: drops trailer after EOI", has(clean, "TRAILER"), false);
eq("strip: idempotent", Buffer.from(stripJpegMetadata(clean)).equals(Buffer.from(clean)), true);
eq("strip: result still inspects", inspectJpeg(clean).ok, true);

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
eq("reject PNG", inspectJpeg(png), { ok: false, error: "The photo must be a JPEG image" });
eq("reject empty", inspectJpeg(new Uint8Array()).ok, false);
const noEoi = photo.slice(0, 2 + app0.length + app1.length + xmp.length + com.length + dqt.length + sof0.length + dht.length + sos.length + 3);
eq("reject truncated (no EOI)", inspectJpeg(noEoi).ok, false);
eq("reject truncated mid-APP1", inspectJpeg(photo.slice(0, 2 + app0.length + 10)).ok, false);
const lying = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]);
eq("reject segment length past end", inspectJpeg(lying).ok, false);
const noFrame = new Uint8Array([0xff, 0xd8, ...app0, ...sos, ...entropy, ...eoi]);
eq("reject scan with no SOF", inspectJpeg(noFrame).ok, false);
const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
huge.set([0xff, 0xd8, 0xff]);
eq("reject > 2 MB", inspectJpeg(huge), { ok: false, error: "The photo is larger than 2 MB" });
let threw = false;
try {
  stripJpegMetadata(png);
} catch {
  threw = true;
}
eq("strip throws on non-JPEG", threw, true);

// ── 2. CSV ──────────────────────────────────────────────────────────────────
eq("csv plain", csvField("PUMP"), "PUMP");
eq("csv comma", csvField("A,B"), '"A,B"');
eq("csv quote", csvField('6" PIPE'), '"6"" PIPE"');
eq("csv newline", csvField("LINE1\nLINE2"), '"LINE1\nLINE2"');
eq("csv null", csvField(null), "");
eq("csv number", csvField(3), "3");
eq("csv formula guard", csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
eq("csv formula guard + quoting", csvField("=A1,B1"), `"'=A1,B1"`);
eq("csv negative number untouched", csvField(-2), "-2");
eq("csv rows", toCsv(["Ref No", "Title"], [["BRK-2026-000001", "TAP, LEAKING"]]), 'Ref No,Title\r\nBRK-2026-000001,"TAP, LEAKING"\r\n');

// ── 3. SLA + tones ──────────────────────────────────────────────────────────
const NOW = Date.UTC(2026, 9, 23, 6, 0, 0);
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;
eq("due in 3 hours", dueWords("open", iso(3 * H), NOW), "Due in 3 hours");
eq("due in 1 hour", dueWords("in_progress", iso(H), NOW), "Due in 1 hour");
eq("due in 45 min", dueWords("open", iso(45 * 60_000), NOW), "Due in 45 mins");
eq("2 days late", dueWords("open", iso(-48 * H), NOW), "2 days late");
eq("blocked is paused", dueWords("blocked", iso(-48 * H), NOW), "Paused");
eq("closed owes nothing", dueWords("closed", iso(-48 * H), NOW), "");
eq("no due date", dueWords("open", null, NOW), "No due date");
eq("late: open past due", isLate("open", iso(-1), NOW), true);
eq("late: blocked never", isLate("blocked", iso(-99 * H), NOW), false);
eq("late: fixed never", isLate("fixed", iso(-99 * H), NOW), false);
eq("late: not yet", isLate("open", iso(1), NOW), false);
eq("days late 3", daysLate("in_progress", iso(-3 * 24 * H - 1), NOW), 3);
eq("days late 0 when on time", daysLate("open", iso(H), NOW), 0);
eq("span 1 day", spanWords(24 * H), "1 day");
eq("tone closed (ticket override)", ticketStatusTone("closed"), "success");
eq("tone fixed", ticketStatusTone("fixed"), "success");
eq("tone cancelled", ticketStatusTone("cancelled"), "danger");
eq("tone withdrawn", ticketStatusTone("withdrawn"), "neutral");
eq("tone blocked", ticketStatusTone("blocked"), "danger");
eq("tone in_progress", ticketStatusTone("in_progress"), "info");
eq("tone open", ticketStatusTone("open"), "neutral");
// requirements (0751): Pending waits on Stores (override); the rest are the shared table's
eq("rq tone open = Pending (override)", requirementStatusTone("open"), "warning");
eq("rq tone approved", requirementStatusTone("approved"), "success");
eq("rq tone fulfilled", requirementStatusTone("fulfilled"), "success");
eq("rq tone rejected", requirementStatusTone("rejected"), "danger");
eq("rq tone withdrawn", requirementStatusTone("withdrawn"), "neutral");

// ── 4. alerts + permissions ─────────────────────────────────────────────────
const registryResolve = Object.entries(NOTIFICATION_EVENTS)
  .filter(([, d]) => d.module === "resolve")
  .map(([k]) => k)
  .sort();
eq("every resolve event has wording, and only those", Object.keys(RESOLVE_MESSAGES).sort(), registryResolve);
eq("twenty-three resolve events (plan §8 + §10.6 + service desk §4 + assist rq_update)", registryResolve.length, 23);
const empty = { ref_no: null, title: null, place_name: null, note: null, meta: {} };
for (const [k, build] of Object.entries(RESOLVE_MESSAGES)) {
  const m = build(empty);
  eq(`${k} has a title`, m.title.length > 0, true);
  eq(`${k} names no uuid`, /[0-9a-f]{8}-[0-9a-f]{4}-/.test(m.title + m.body), false);
}
const ctx = { ref_no: "BRK-2026-000007", title: "TAP LEAKING", place_name: "BLOCK A", note: "STILL DRIPS", meta: { stars: 4, days_late: 3 } };
eq("routed body", RESOLVE_MESSAGES["resolve.ticket_routed"](ctx).body, "BRK-2026-000007 · TAP LEAKING — BLOCK A");
eq("rated title", RESOLVE_MESSAGES["resolve.rated"](ctx).title, "Your fix was rated 4 of 5");
eq("overdue title", RESOLVE_MESSAGES["resolve.overdue"](ctx).title, "A job is 3 days overdue");
eq("dangerous is danger", RESOLVE_MESSAGES["resolve.dangerous"](ctx).type, "danger");
eq("digest count from list", RESOLVE_MESSAGES["resolve.digest"]({ ...empty, meta: { tickets: [1, 2] } }).title, "2 jobs are a week or more overdue");
eq("isResolveEvent no", isResolveEvent("resolve.nope"), false);
eq("isResolveEvent proto", isResolveEvent("toString"), false);
eq("href ticket", resolveHref("resolve.fixed", "abc"), "/resolve/tickets/abc");
eq("href digest", resolveHref("resolve.digest", null), "/resolve/jobs?overdue=1");
eq("RH spells real actions", Object.values(RH).every((a) => (ACTIONS as readonly string[]).includes(a)), true);
eq("RH actions distinct", new Set(Object.values(RH)).size, Object.keys(RH).length);

// ── 5. schemas ──────────────────────────────────────────────────────────────
const placeId = "11111111-1111-4111-8111-111111111111";
const sub = submitBrokenSchema.safeParse({
  place_id: placeId,
  trade_id: "",
  title: "  tap leaking ",
  description: "near the sink",
  is_dangerous: "on",
  gps_lat: "11.016789",
  gps_lng: "",
  source: "qr",
});
eq("submit parses", sub.success, true);
if (sub.success) {
  eq("title CAPS + trimmed", sub.data.title, "TAP LEAKING");
  eq("description CAPS", sub.data.description, "NEAR THE SINK");
  eq("dangerous from 'on'", sub.data.is_dangerous, true);
  eq("blank trade → null", sub.data.trade_id, null);
  eq("gps rounded to 4dp", sub.data.gps_lat, 11.0168);
  eq("blank gps → null", sub.data.gps_lng, null);
}
eq("absent optional keys parse", submitBrokenSchema.safeParse({ place_id: placeId, title: "X" }).success, true);
eq("bad gps refused", submitBrokenSchema.safeParse({ place_id: placeId, title: "X", gps_lat: "123" }).success, false);
eq("blank title refused", submitBrokenSchema.safeParse({ place_id: placeId, title: "   " }).success, false);
const us = unitSettingsSchema.safeParse({
  escalation_hour: 8, ordinary_days: 2, routine_days: 7, purchase_days: 7, dup_window_days: 0,
  dispute_window_days: 7, report_limit_24h: 10, spot_check_one_in: 0, page_cap_per_day: 20,
  suppress_notifications: false,
});
eq("settings: windows and spot-check may be 0 (DB allows)", us.success, true);

// ── 6. complaints: tracking token (plan §10.2) ───────────────────────────────
const realToken = randomBytes(32).toString("base64url");
eq("a 32-byte token is 43 chars", realToken.length, 43);
eq("a real token is token-shaped", isTrackingToken(realToken), true);
const T = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
eq("vector token is 43", T.length, 43);
eq("token ok", isTrackingToken(T), true);
eq("token 42 refused", isTrackingToken(T.slice(1)), false);
eq("token 44 refused", isTrackingToken(T + "A"), false);
eq("padded token refused", isTrackingToken(T.slice(1) + "="), false);
eq("base64 (+/) refused", isTrackingToken(T.slice(2) + "+/"), false);
eq("space refused", isTrackingToken(" " + T.slice(1)), false);
eq("newline-suffixed refused", isTrackingToken(T + String.fromCharCode(10)), false);
eq("non-string refused", isTrackingToken(12345), false);
eq("hash is sha256 hex of utf8", hashTrackingToken(T), createHash("sha256").update(T, "utf8").digest("hex"));
eq("hash shape", /^[0-9a-f]{64}$/.test(hashTrackingToken(T)), true);

const calls: { fn: string; args: Record<string, unknown> }[] = [];
const spy = (data: unknown, error: { message: string; code?: string } | null = null): TrackRpc =>
  async (fn, args) => {
    calls.push({ fn, args });
    return { data, error };
  };
const leaky = {
  ref_no: "CMP-2026-000001", subject: "LIGHTS", status: "in_progress", created_at: "2026-10-23T04:30:00Z",
  first_response_at: null, resolved_at: null, withdrawn_at: null, resolution_message: null,
  reporter_id: "11111111-1111-4111-8111-111111111111", description: "SECRET", owner_id: "x", notes: ["INTERNAL"],
};
for (const bad of ["", "short", T.slice(1), T + "=", "../../etc/passwd", "' or 1=1 --" + T.slice(12)]) {
  calls.length = 0;
  eq(`malformed ${JSON.stringify(bad).slice(0, 20)} → null`, await trackWith(spy(leaky), bad), null);
  eq(`malformed ${JSON.stringify(bad).slice(0, 20)} → no RPC call`, calls.length, 0);
}
calls.length = 0;
eq("malformed withdraw → no RPC call", (await withdrawWith(spy(null), "nope")).ok, false);
eq("malformed withdraw made no call", calls.length, 0);

calls.length = 0;
const tracked = await trackWith(spy(leaky), T);
eq("track: one RPC call", calls.length, 1);
eq("track: calls rh_track_complaint", calls[0]?.fn, "rh_track_complaint");
eq("track: only the hash is sent", Object.values(calls[0]?.args ?? {}), [hashTrackingToken(T)]);
eq("track: the token itself never sent", JSON.stringify(calls[0]?.args).includes(T), false);
eq("track: exactly the public keys", Object.keys(tracked ?? {}).sort(), [
  "created_at", "first_response_at", "ref_no", "resolution_message", "resolved_at", "status", "subject", "withdrawn_at",
]);
eq("track: no description leaks", JSON.stringify(tracked).includes("SECRET"), false);
eq("track: unknown token → null", await trackWith(spy(null), T), null);
eq("track: bad status → null", pickTracked({ ...leaky, status: "closed" }), null);
calls.length = 0;
await withdrawWith(spy({ status: "withdrawn" }), T);
eq("withdraw: only the hash is sent", Object.values(calls[0]?.args ?? {}), [hashTrackingToken(T)]);

// ── 7. complaints: alert wording never leaks (plan §10.6) ─────────────────────
const SUBJECT = "HARASSMENT BY LINE SUPERVISOR RAMESH";
const cmp = {
  ref_no: "CMP-2026-000001", title: SUBJECT, place_name: null, note: "STOPPED AFTER WARNING",
  meta: { level: 1 }, kind: "complaint", response_due_at: "2026-10-26T04:30:00Z",
};
for (const sens of [true, null, undefined]) {
  for (const [k, build] of Object.entries(RESOLVE_MESSAGES)) {
    const m = build({ ...cmp, is_sensitive: sens });
    eq(`${k} (sensitive=${sens}) never prints the subject`, (m.title + m.body).includes("HARASSMENT"), false);
  }
}
eq("sensitive new-complaint title", RESOLVE_MESSAGES["resolve.complaint_new"]({ ...cmp, is_sensitive: true }).title,
  "New sensitive complaint CMP-2026-000001, respond by 26/10/2026, 10:00 am");
eq("non-sensitive complaint shows its subject", RESOLVE_MESSAGES["resolve.complaint_new"]({ ...cmp, title: "CANTEEN FOOD", is_sensitive: false }).body,
  "CMP-2026-000001 · CANTEEN FOOD");
eq("hidesSubject: broken never", hidesSubject({ kind: "broken", is_sensitive: null }), false);
eq("hidesSubject: complaint unknown", hidesSubject({ kind: "complaint", is_sensitive: undefined }), true);
eq("IST deadline", istDateTime("2026-10-23T18:45:00Z"), "24/10/2026, 12:15 am");
eq("href complaint", resolveHref("resolve.complaint_new", "t1"), "/resolve/tickets/t1");

// ── 8. Service Desk: priority, the two clocks, refs, alerts (service-desk-plan) ──
eq("impact: cannot work → high", priorityForImpact("cannot_work", "low"), "high");
eq("impact: degraded → medium", priorityForImpact("degraded", "low"), "medium");
eq("impact: request → low", priorityForImpact("request", "low"), "low");
eq("impact: category floor wins (request, medium)", priorityForImpact("request", "medium"), "medium");
eq("impact: category floor wins (degraded, high)", priorityForImpact("degraded", "high"), "high");
eq("impact: higher ask wins over floor", priorityForImpact("cannot_work", "medium"), "high");
for (const i of IMPACTS) {
  for (const f of ["high", "medium", "low"] as const) {
    eq(`impact ${i}/${f}: never urgent`, priorityForImpact(i, f) === ("urgent" as string), false);
  }
}
eq("SLA seed: four rows urgent → low", DEFAULT_SERVICE_SLA.map((r) => r.priority), ["urgent", "high", "medium", "low"]);
eq("SLA seed: minutes", DEFAULT_SERVICE_SLA.map((r) => [r.response_minutes, r.resolution_minutes]), [[10, 30], [20, 60], [30, 120], [60, 240]]);

const T0 = Date.parse("2026-10-26T04:30:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
eq("response: pending inside the window", responseState(null, at(10), T0), "pending");
eq("response: breached past the window", responseState(null, at(-1), T0), "breached");
eq("response: met on time", responseState(at(-5), at(10), T0), "met");
eq("response: met exactly at due", responseState(at(10), at(10), T0), "met");
eq("response: late answer stays breached", responseState(at(11), at(10), T0), "breached");
eq("response: no due date → pending", responseState(null, null, T0), "pending");
eq("response: withdrawn unanswered → met (as SQL)", responseState(null, at(-30), T0, "withdrawn"), "met");
eq("response: cancelled unanswered → met (as SQL)", responseState(null, at(-30), T0, "cancelled"), "met");
eq("response: open unanswered past due → breached", responseState(null, at(-30), T0, "open"), "breached");

eq("resolution: on track with plenty left", resolutionState("in_progress", at(100), 120, T0), "on_track");
eq("resolution: at risk at 80 % used (24 of 120 left)", resolutionState("in_progress", at(24), 120, T0), "at_risk");
eq("resolution: on track just before 80 %", resolutionState("in_progress", at(25), 120, T0), "on_track");
eq("resolution: breached past due", resolutionState("assigned", at(-1), 120, T0), "breached");
eq("resolution: on hold is paused, even past due", resolutionState("on_hold", at(-100), 120, T0), "paused");
for (const st of ["resolved", "closed", "cancelled", "withdrawn"]) {
  eq(`resolution: ${st} is done`, resolutionState(st, at(-100), 120, T0), "done");
  eq(`minutesLeft: ${st} → null`, minutesLeft(st, at(30), T0), null);
}
eq("resolution: no due date → on track", resolutionState("open", null, 120, T0), "on_track");
eq("SD_AT_RISK_SHARE", SD_AT_RISK_SHARE, 0.8);
eq("minutesLeft: 30 ahead", minutesLeft("in_progress", at(30), T0), 30);
eq("minutesLeft: floors a part minute", minutesLeft("in_progress", new Date(T0 + 90_000).toISOString(), T0), 1);
eq("minutesLeft: negative when over", minutesLeft("in_progress", at(-45), T0), -45);
eq("minutesLeft: on hold → null", minutesLeft("on_hold", at(30), T0), null);
eq("minutesLeft: no due → null", minutesLeft("open", null, T0), null);
eq("clockWords: left", clockWords("on_track", 45), "45 mins left");
eq("clockWords: over", clockWords("breached", -120), "2 hours over");
eq("clockWords: zero reads 1 min left", clockWords("at_risk", 0), "1 min left");
eq("clockWords: paused", clockWords("paused", 10), "Paused");
eq("clockWords: done", clockWords("done", 10), "");
eq("tone: breached danger", slaClockTone("breached"), "danger");
eq("tone: at risk warning", slaClockTone("at_risk"), "warning");
eq("tone: met success", slaClockTone("met"), "success");
eq("tone: paused neutral", slaClockTone("paused"), "neutral");

eq("SERVICE_REF ok", SERVICE_REF.test("SD-2026-000123"), true);
for (const bad of ["SD-26-000123", "SD-2026-12345", "sd-2026-000123", "RH-2026-000123", "SD-2026-0001234", " SD-2026-000123"]) {
  eq(`SERVICE_REF refuses ${JSON.stringify(bad)}`, SERVICE_REF.test(bad), false);
}
eq("isServiceRef non-string", isServiceRef(123), false);
eq("KB_REF ok", KB_REF.test("KB-000123"), true);
for (const bad of ["KB-00123", "KB-2026-000123", "kb-000123", "KB-0001234"]) {
  eq(`KB_REF refuses ${JSON.stringify(bad)}`, KB_REF.test(bad), false);
}

const sd = {
  ref_no: "SD-2026-000123", title: "PRINTER NOT WORKING", place_name: null, note: null,
  meta: {}, kind: "service", response_due_at: "2026-10-26T04:40:00Z", due_at: "2026-10-26T06:30:00Z",
};
const SD_KEYS = Object.keys(NOTIFICATION_EVENTS).filter((k) => k.startsWith("resolve.sd_"));
eq("every resolve.sd_* has wording", SD_KEYS.filter((k) => !isResolveEvent(k)), []);
const SD_ACTIONS: [string, string, Record<string, unknown>][] = [
  ["resolve.sd_new", "created", {}],
  ["resolve.sd_new", "reclassified", { rerouted: true }],
  ["resolve.assigned", "claimed", {}],
  ["resolve.assigned", "assigned", {}],
  ["resolve.sd_update", "held", {}],
  ["resolve.sd_update", "resumed", {}],
  ["resolve.sd_update", "cancelled", {}],
  ["resolve.sd_reply", "replied", { by_staff: true }],
  ["resolve.sd_resolved", "resolved", {}],
  ["resolve.closed", "confirmed", {}],
  ["resolve.closed", "auto_closed", { days: 3 }],
  ["resolve.sd_reopened", "reopened", {}],
  ["resolve.sd_urgent", "overridden", { kind: "financial_risk" }],
  ["resolve.sd_warning", "sla_warning", { clock: "resolution", minutes_left: 20 }],
  ["resolve.sd_breach", "sla_breached", { clock: "response" }],
  ["resolve.sd_breach", "sla_breached", { clock: "resolution" }],
  ["resolve.sd_stale", "stale", { level: "remind", days: 3 }],
  ["resolve.sd_stale", "stale", { level: "escalate", days: 4 }],
  ["resolve.rated", "rated", { stars: 5 }],
];
for (const [k, action, meta] of SD_ACTIONS) {
  const m = RESOLVE_MESSAGES[k as keyof typeof RESOLVE_MESSAGES]({ ...sd, action, meta, note: "WAITING FOR TONER" });
  eq(`${k}/${action}: ref first`, (m.title + m.body).includes("SD-2026-000123"), true);
  eq(`${k}/${action}: title in the body`, m.body.includes("PRINTER NOT WORKING"), true);
  eq(`${k}/${action}: no undefined/null text`, /undefined|null|NaN/.test(m.title + m.body), false);
  eq(`${k}/${action}: href is the ticket`, resolveHref(k as keyof typeof RESOLVE_MESSAGES, "t9"), "/resolve/tickets/t9");
}
eq("sd_new carries both deadlines", RESOLVE_MESSAGES["resolve.sd_new"]({ ...sd, action: "created" }).body,
  "SD-2026-000123 · PRINTER NOT WORKING. Respond by 26/10/2026, 10:10 am. Resolve by 26/10/2026, 12:00 pm.");
eq("sd_breach response wording", RESOLVE_MESSAGES["resolve.sd_breach"]({ ...sd, meta: { clock: "response" } }).title,
  "IT request SD-2026-000123 was not answered in time");
eq("sd_warning minutes", RESOLVE_MESSAGES["resolve.sd_warning"]({ ...sd, meta: { minutes_left: 20 } }).title,
  "IT request SD-2026-000123 is due in 20 min");
eq("sd_update held carries the reason", RESOLVE_MESSAGES["resolve.sd_update"]({ ...sd, action: "held", note: "WAITING FOR TONER" }).body,
  "SD-2026-000123 · PRINTER NOT WORKING. WAITING FOR TONER");
eq("sd_stale escalate is danger", RESOLVE_MESSAGES["resolve.sd_stale"]({ ...sd, meta: { level: "escalate", days: 4 } }).type, "danger");
eq("broken wording untouched by the service branch", RESOLVE_MESSAGES["resolve.assigned"]({ ...sd, kind: "broken" }).title, "A job was assigned");
eq("sd wording hides a would-be complaint's subject",
  RESOLVE_MESSAGES["resolve.sd_new"]({ ...sd, kind: "complaint", is_sensitive: null }).body.includes("PRINTER"), false);

// ── requirements (Raagam Assist, 0751) ──────────────────────────────────────
const rq = { ref_no: "REQ-2026-000123", title: "MACHINE OIL", place_name: null, note: null, meta: {}, kind: "requirement" };
eq("rq routed body", RESOLVE_MESSAGES["resolve.ticket_routed"]({ ...rq, rq_qty: 5, rq_needed_by: "week" }).body,
  "REQ-2026-000123: MACHINE OIL ×5, needed this week");
eq("rq routed from the created meta", RESOLVE_MESSAGES["resolve.ticket_routed"]({ ...rq, meta: { qty: 2, needed_by: "today" } }).body,
  "REQ-2026-000123: MACHINE OIL ×2, needed today");
eq("rq routed title", RESOLVE_MESSAGES["resolve.ticket_routed"](rq).title, "New request REQ-2026-000123");
eq("rq approved", RESOLVE_MESSAGES["resolve.rq_update"]({ ...rq, action: "approved", rq_qty: 5 }).title, "Your request REQ-2026-000123 was approved");
eq("rq rejected carries the reason", RESOLVE_MESSAGES["resolve.rq_update"]({ ...rq, action: "rejected", rq_qty: 5, note: "STOCK AVAILABLE" }).body,
  "REQ-2026-000123: MACHINE OIL ×5. Reason: STOCK AVAILABLE");
eq("rq rejected is a warning", RESOLVE_MESSAGES["resolve.rq_update"]({ ...rq, action: "rejected" }).type, "warning");
eq("rq given", RESOLVE_MESSAGES["resolve.rq_update"]({ ...rq, action: "fulfilled" }).title, "Your request REQ-2026-000123 was given");
for (const action of ["approved", "rejected", "fulfilled"]) {
  const m = RESOLVE_MESSAGES["resolve.rq_update"]({ ...rq, action });
  eq(`rq ${action}: no undefined/null text`, /undefined|null|NaN/.test(m.title + m.body), false);
}
eq("broken routed untouched by the rq branch", RESOLVE_MESSAGES["resolve.ticket_routed"](ctx).title, "A problem was reported to you");

if (failures) {
  console.log(`\ncheck:resolve — FAILED: ${failures} of ${failures + passes} assertions`);
  process.exit(1);
}
console.log(`check:resolve — ok: ${passes} assertions (jpeg strip, csv, sla, tones, alerts, schemas, service desk).`);
