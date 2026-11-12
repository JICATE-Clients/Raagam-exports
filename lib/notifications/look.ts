import {
  CalendarClock,
  ClipboardList,
  Headset,
  MessageCircleMore,
  Ruler,
  Ship,
  Stamp,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { MODULE_HUE } from "@/components/navigation/module-hue";
import { buyerInitials, buyerTint } from "@/lib/ui/buyer-glow";
import { notificationEvent, type NotificationEventDef } from "./events";

/**
 * HOW AN ALERT LOOKS — one file, three readers (user 2026-11-06, the approved
 * "Raagam Notifications Redesign" mockup): the bell, the Notifications page and
 * the Windows / phone pop-up (`notify()` builds its icon URL from here).
 *
 *   FACE   — the sender's HR photo, else their initials on the same per-name
 *            colour a Pulse avatar wears (`buyerTint`), so one person is one
 *            colour on every surface. No sender (a sweep, a job) → the
 *            module's own icon fills the circle.
 *   BADGE  — the module, in the rail's colour (`MODULE_HUE`), so violet always
 *            means Approvals and rose always means Pulse.
 *   WORDS  — one colour per KIND of word (`textRuns`): document numbers blue,
 *            amounts and percentages dark and bold, the rest of the sentence
 *            grey. Found by pattern, so the 33 places that raise alerts need no
 *            change to get it.
 *
 * Client-safe and pure.
 */

type ModuleKey = NotificationEventDef["module"];

export type NotificationModuleLook = { key: ModuleKey; label: string; hue: string; icon: LucideIcon };

/** The rail module each alert family belongs to — its colour comes from there. */
const MODULES: Record<ModuleKey, { label: string; railHref: string; icon: LucideIcon }> = {
  approvals: { label: "Approvals", railHref: "/approvals", icon: Stamp },
  orders: { label: "Orders", railHref: "/orders", icon: ClipboardList },
  cad: { label: "CAD", railHref: "/orders", icon: Ruler },
  ta: { label: "T&A", railHref: "/orders", icon: CalendarClock },
  comms: { label: "Pulse", railHref: "/comms", icon: MessageCircleMore },
  admin: { label: "Administration", railHref: "/admin", icon: UserCog },
  resolve: { label: "Help & Repairs", railHref: "/resolve", icon: Headset },
  logistics: { label: "Logistics", railHref: "/logistics", icon: Ship },
};

export const NOTIFICATION_MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export function moduleLook(key: ModuleKey): NotificationModuleLook {
  const m = MODULES[key];
  return { key, label: m.label, hue: MODULE_HUE[m.railHref] ?? "#475569", icon: m.icon };
}

/** The module of a stored row, from its event key (0673). Null for a pre-0673 row. */
export function notificationModule(eventKey: string | null | undefined): NotificationModuleLook | null {
  const def = eventKey ? notificationEvent(eventKey) : null;
  return def ? moduleLook(def.module) : null;
}

export function isNotificationModule(v: string): v is ModuleKey {
  return v in MODULES;
}

/** The sender's initials and colour — the same pair a Pulse avatar draws. */
export function actorFace(name: string | null | undefined): { initials: string; ink: string; glow: string } {
  const t = buyerTint(name);
  return { initials: buyerInitials(name), ink: t.ink, glow: t.glow };
}

/**
 * The pop-up's picture: `/api/notify-icon/<module>/<initials>-<colour>.png`.
 * It ENDS IN `.png` on purpose — `proxy.ts`'s matcher passes image paths
 * without a session, and the operating system fetches a notification icon
 * from the service worker, where a login redirect would leave a broken image.
 * The photo rides as `?p=`; the route draws only from this project's storage.
 */
export function notificationIconPath(
  module: ModuleKey | null,
  actor: { name: string | null; photo: string | null } | null,
): string {
  const m = module ?? "approvals";
  if (!actor) return `/api/notify-icon/${m}/module.png`;
  const face = actorFace(actor.name);
  const initials = encodeURIComponent(face.initials.replace(/[^A-Z0-9]/g, "") || "R");
  const path = `/api/notify-icon/${m}/${initials}-${face.ink.replace("#", "")}.png`;
  return actor.photo ? `${path}?p=${encodeURIComponent(actor.photo)}` : path;
}

export type TextRun = { kind: "text" | "doc" | "amount"; text: string };

/*
 * PO/26-27/0142 · RE/26-27/0388 · REV/26-27/0001 · BUD/0091 · SWO/26-27/12 —
 * two to six capitals, then one or more "/segment"s, at least one holding a digit.
 * ₹7,41,600 · ₹ 1,200.50 · 4% · 11.4%.
 */
const RUN = /(\b[A-Z]{2,6}(?:\/[A-Z0-9-]+)*\/[A-Z0-9-]*\d[A-Z0-9-]*\b)|(₹\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%)/g;

/** Split an alert's text into runs the bell colours by kind. */
export function textRuns(text: string | null | undefined): TextRun[] {
  if (!text) return [];
  const out: TextRun[] = [];
  let last = 0;
  for (const m of text.matchAll(RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: m[1] ? "doc" : "amount", text: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * The bell's day heading: "Today", "Yesterday", else DD/MM/YYYY. LOCAL days, read
 * in the browser (the bell fetches after mount), so a 1 am alert in Tiruppur is
 * not "yesterday" because the server's clock is UTC.
 */
export function notificationDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (localDay(d) === localDay(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (localDay(d) === localDay(y)) return "Yesterday";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "HH:MM" local, for `fmtTime` (which owns the 12-hour clock). */
export function notificationClock(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
