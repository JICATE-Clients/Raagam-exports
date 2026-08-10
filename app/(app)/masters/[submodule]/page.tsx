import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { findSubmodule } from "@/lib/masters/submodules";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";

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
