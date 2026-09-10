import {
  Anchor,
  BadgeCheck,
  Banknote,
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  CalendarOff,
  Clock,
  CreditCard,
  FileSignature,
  Globe2,
  HandCoins,
  Handshake,
  IdCard,
  Landmark,
  Map,
  MapPin,
  PackageCheck,
  Percent,
  PiggyBank,
  ScanSearch,
  Stamp,
  Timer,
  TrendingDown,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { HubIconTone } from "./hub-card";

/**
 * WHICH ICON A MASTER-DATA HUB CARD DRAWS, resolved from a NAME.
 *
 * Every card in Master Data drew the same `Tag`, so a twelve-card hub was
 * twelve identical blue labels and the icon column carried no information at
 * all — the operator read the text every time, and the tiles were only
 * distinguishable by position (client 2026-09-04, HR ▸ "i want some logos for
 * it", against a reference nav where every row has its own mark).
 *
 * ## WHY A NAME AND NOT THE COMPONENT
 *
 * The obvious shape is `icon: HandCoins` straight on the registry entry. It is
 * wrong here: `lib/masters/submodules.ts` is DATA, imported by server
 * components and read by tooling, and putting a React component in it makes
 * every consumer depend on `lucide-react` — including ones that only want to
 * know a slug. The registry names an icon; this module is the only place that
 * turns a name into a component, exactly as `lib/nav/module-groups.ts` keeps
 * `href` strings rather than route objects.
 *
 * ## AN UNKNOWN NAME IS NOT AN ERROR
 *
 * `hubIcon()` falls back to the card's default. A registry entry may name an
 * icon this map has not learned yet — a typo, or a name added in a branch that
 * landed first — and the honest answer is the generic tile the card already
 * had, never a crash on a page whose job is to list where to go next.
 *
 * To give a card an icon: add the lucide import here, add the name to the map,
 * then set `icon: "<name>"` on the child in `submodules.ts`. Cards that name
 * nothing keep `Tag`, so this can be filled in a sub-module at a time.
 */
export type HubMark = { icon: LucideIcon; tone: HubIconTone };

/**
 * TONES ARE LAID OUT AGAINST THE 3-COLUMN GRID, not chosen per entity in
 * isolation. Reading across and down, no tile touches another of its own tone —
 * which is the only thing colour has to achieve here:
 *
 *   success  danger   accent
 *   info     warning  primary
 *   accent   success  info
 *   primary  warning  danger
 *
 * Where the subject has a natural reading, it keeps it: Allowance pays out
 * (success) and Deduction takes back (danger); Advance/Loan is money (success)
 * and PF/ESI is the statutory deduction beside it (danger). The rest are simply
 * distinct — Hostel is not "teal" for any reason beyond sitting between a red
 * and a blue.
 */
export const MASTER_HUB_ICONS: Readonly<Record<string, HubMark>> = {
  allowance: { icon: HandCoins, tone: "success" },
  deduction: { icon: TrendingDown, tone: "danger" },
  "hostel-category": { icon: BedDouble, tone: "accent" },
  holiday: { icon: CalendarDays, tone: "info" },
  "work-timing": { icon: Clock, tone: "warning" },
  "working-hour": { icon: Timer, tone: "primary" },
  "leave-type": { icon: CalendarOff, tone: "accent" },
  "advance-loan-type": { icon: Wallet, tone: "success" },
  department: { icon: Building2, tone: "info" },
  designation: { icon: BadgeCheck, tone: "primary" },
  "employee-category": { icon: Users, tone: "warning" },
  "pf-esi-control": { icon: Percent, tone: "danger" },
  // System sub-module (0546, client 2026-09-07: "did you see" the HR sweep's
  // icons, wanting the new TA Approvals tile to match rather than draw the
  // generic `Tag`). A rubber stamp for a dictionary of technical sign-offs.
  "ta-approvals": { icon: Stamp, tone: "accent" },

  /**
   * ASSOCIATES (client 2026-09-08, "all items in Associates use the same blue
   * tag icon" — match the HR page).
   *
   * NOTHING ABOUT THE CARD ITSELF CHANGED, and that is worth stating because
   * the request asked for HR's "card container styling, padding, font weights
   * and layout structure" to be copied across. There is nothing to copy:
   * `/masters/associates` and `/masters/hr` are the SAME route
   * (`app/(app)/masters/[submodule]/page.tsx` → `HubPage` → `HubCard`), so the
   * grid, padding, weights and rhythm were already identical to the pixel. The
   * only thing HR had and Associates did not was an `icon` name on each
   * registry entry — without one `hubMark()` returns undefined and the card
   * keeps its default `Tag`, which is exactly the "same blue tag" reported.
   *
   * TONES FOLLOW THE ADJACENCY RULE ABOVE, over five rows rather than four:
   *
   *   info     accent   warning     country · port · destination
   *   primary  danger   success     bank · applicant · receivable-term
   *   warning  info     accent      customer · notify · consignee
   *   danger   primary  info        payment-term · vendor · employee
   *   accent   success  warning     gst-number-check · our-banks · zones
   *
   * No tile touches another of its own tone across or down. Where the subject
   * has a natural reading it keeps it, the same way Allowance/Deduction do:
   * Receivable Term is money coming in (success) and Payment Term is money
   * going out (danger). The rest are simply distinct.
   */
  country: { icon: Globe2, tone: "info" },
  port: { icon: Anchor, tone: "accent" },
  destination: { icon: MapPin, tone: "warning" },
  bank: { icon: Landmark, tone: "primary" },
  applicant: { icon: FileSignature, tone: "danger" },
  "receivable-term": { icon: Banknote, tone: "success" },
  customer: { icon: Handshake, tone: "warning" },
  notify: { icon: Bell, tone: "info" },
  consignee: { icon: PackageCheck, tone: "accent" },
  "payment-term": { icon: CreditCard, tone: "danger" },
  vendor: { icon: Truck, tone: "primary" },
  employee: { icon: IdCard, tone: "info" },
  // A test bench, not a master — it saves nothing and owns no table, so it gets
  // a magnifying glass rather than a document.
  "gst-number-check": { icon: ScanSearch, tone: "accent" },
  // OUR accounts, as against `bank` (the master of everyone else's) — a
  // different mark on purpose, since two Landmarks would undo the point.
  "our-banks": { icon: PiggyBank, tone: "success" },
  zones: { icon: Map, tone: "warning" },
};

/** The mark for a name, or `undefined` so the card keeps its own defaults. */
export function hubMark(name: string | undefined): HubMark | undefined {
  return name ? MASTER_HUB_ICONS[name] : undefined;
}
