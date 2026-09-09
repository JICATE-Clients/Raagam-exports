import {
  BadgeCheck,
  BedDouble,
  Building2,
  CalendarDays,
  CalendarOff,
  Clock,
  HandCoins,
  Percent,
  Stamp,
  Timer,
  TrendingDown,
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
};

/** The mark for a name, or `undefined` so the card keeps its own defaults. */
export function hubMark(name: string | undefined): HubMark | undefined {
  return name ? MASTER_HUB_ICONS[name] : undefined;
}
