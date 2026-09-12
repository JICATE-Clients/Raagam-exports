import { ModuleHub } from "@/components/shell/module-hub";

/**
 * The HR & Payroll module landing page: one card per sub-module, from
 * `lib/nav/module-groups.ts`.
 *
 * It was a hand-written grid of 14 LEAF screens — and `module-hub.tsx`'s own
 * header names this page as one of the four it was built to replace ("`/hr` 14
 * against 4"). Two things were wrong with it, and the second is the one that
 * hides:
 *
 * - **It flattened the middle level away.** The registry has said for a month
 *   that HR is four sub-modules (People · Time & Attendance · Pay · Compliance
 *   & Setup); the landing page listed their children instead, so the groups
 *   existed in the sidebar and nowhere on the page. Two levels in the sidebar,
 *   the third on the page — AGENTS.md ▸ "The sidebar lists SUB-MODULES".
 * - **It drew its own `Card`s.** So it silently had none of what `HubPage`
 *   carries: the `unavailable` state, the record counts, the "N screens" glyph.
 *   A duplicated list drifts in CAPABILITY as well as in facts, and that half
 *   stays invisible until a card lies.
 *
 * The three Stat tiles it drew (workers · staff · contractors) are not lost —
 * they move one level down, to where they are a fact about a screen rather than
 * about the module: `/hr/people`'s cards read their counts from
 * `hub-count-map.ts`, which already names all three tables.
 */
export default function HrPage() {
  return <ModuleHub moduleHref="/hr" />;
}
