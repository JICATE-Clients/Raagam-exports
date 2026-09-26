import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { findSubmodule } from "@/lib/masters/submodules";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";
import { hubMark } from "@/components/masters/hub-icons";

export default async function SubmodulePage({
  params,
}: {
  params: Promise<{ submodule: string }>;
}) {
  await requirePermission("masters", "view");
  const { submodule } = await params;
  const sub = findSubmodule(submodule);
  // Materials has its own richer route at /masters/materials.
  if (!sub || sub.slug === "materials") notFound();

  // NO REDIRECT — THE SUB-MODULE LISTS ITS SCREENS (user 2026-09-26: "if I
  // click the Associates sub module it directly went to the Allowance child,
  // but need to list the Associate child page … for full master module").
  // The 2026-09-15 redirect to the first child reasoned that the card grid was
  // hidden and the sidebar listed every child — neither is true here: `HubPage`
  // shows cards unless told not to (`hideCards`), and the Master Data sidebar
  // stops at the sub-module name (AGENTS.md "The sidebar lists SUB-MODULES"),
  // so the redirect left this page's children reachable only by landing on
  // the first one. Materials (`/masters/materials`) never redirected.

  const cards: HubCardSpec[] = sub.children.map((c) => ({
    key: c.slug,
    // A `todo` child here still NAVIGATES, unlike a todo card on a sub-module
    // hub: it falls through the generic `/masters/[submodule]/[entity]` resolver
    // onto a real placeholder screen. That is why `HubCard` keys "inert" off a
    // null href rather than off `dashed` — the two look alike and are not.
    href: c.type === "link" ? c.href : `/masters/${sub.slug}/${c.slug}`,
    label: c.label,
    description: c.type === "todo" ? "Not set up yet" : c.description,
    external: c.type === "link" && c.external,
    dashed: c.type === "todo",
    // The registry names a mark; this is the only place the name becomes a
    // component and a tone. Unknown or absent, `hubMark` returns undefined and
    // the card keeps its default `Tag` in `primary`.
    icon: hubMark(c.icon)?.icon,
    tone: hubMark(c.icon)?.tone,
  }));

  return (
    <HubPage
      breadcrumb={{ href: "/masters", label: "Master Data" }}
      title={sub.label}
      description={sub.description}
      note={sub.note}
      status={sub.status === "provisional" ? "provisional" : undefined}
      cards={cards}
    />
  );
}
