import { notFound } from "next/navigation";
import { canViewHref, requirePermission } from "@/lib/auth/server";
import { findGroup } from "@/lib/nav/module-groups";
import { groupHubMark } from "@/lib/nav/group-hub-icons";
import { getSetupSummary } from "@/lib/resolve/setup-summary";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsHome, type SettingsSection } from "@/components/resolve/admin/settings-home";

/**
 * Resolve ▸ Administration — the Settings home (mobile redesign, 2026-10-26).
 *
 * The CARDS still come from `lib/nav/module-groups.ts`, the registry the
 * sidebar reads, so a screen cannot be on one and missing from the other: this
 * page only decides which heading each registered child sits under, and words
 * it the way the operator says it. A child the table below does not place
 * lands under "More" rather than vanishing.
 *
 * It no longer redirects to the first child (GroupHub's behaviour): the page
 * now carries something the sidebar does not — a live one-line summary per
 * settings screen — so it is worth landing on.
 */
const SECTIONS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Who does the work",
    items: [
      { href: "/resolve/setup/trades", label: "Trades" },
      { href: "/resolve/setup/teams", label: "Teams" },
      { href: "/resolve/setup/places", label: "Places & QR" },
      { href: "/resolve/setup/routing", label: "Routing" },
    ],
  },
  {
    title: "What people can pick",
    items: [
      { href: "/resolve/setup/problem-catalog", label: "Problem catalog" },
      { href: "/resolve/setup/service-categories", label: "IT categories" },
      { href: "/resolve/setup/complaint-categories", label: "Concern categories" },
    ],
  },
  {
    title: "Rules & timings",
    items: [
      { href: "/resolve/setup/service-sla", label: "IT response times" },
      { href: "/resolve/setup/unit-settings", label: "Unit settings" },
    ],
  },
];

export default async function Page() {
  const found = findGroup("/resolve", "setup");
  if (!found) notFound();
  const { group, module } = found;
  await requirePermission(module, "view");

  const children = group.children.filter((c) => c.status !== "todo" && c.status !== "unavailable");
  const allowed = new Set<string>();
  for (const c of children) if (await canViewHref(c.href)) allowed.add(c.href);
  const summary = await getSetupSummary();

  const placed = new Set(SECTIONS.flatMap((s) => s.items.map((i) => i.href)));
  const card = (c: (typeof children)[number], label?: string) => {
    const mark = groupHubMark(c.href);
    return {
      href: c.href,
      label: label ?? c.label,
      summary: summary[c.href] ?? c.description,
      icon: mark?.icon,
      tone: mark?.tone,
    };
  };
  const byHref = new Map(children.map((c) => [c.href, c]));

  const sections: SettingsSection[] = SECTIONS.map((s) => ({
    title: s.title,
    cards: s.items.flatMap((i) => {
      const c = byHref.get(i.href);
      return c && allowed.has(c.href) ? [card(c, i.label)] : [];
    }),
  }));
  const rest = children.filter((c) => !placed.has(c.href) && allowed.has(c.href)).map((c) => card(c));
  if (rest.length) sections.push({ title: "More", cards: rest });

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Who does the work, what people can pick, and the rules and timings" />
      <SettingsHome sections={sections.filter((s) => s.cards.length > 0)} />
    </div>
  );
}
