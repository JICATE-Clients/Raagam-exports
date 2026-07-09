import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { findSubmodule } from "@/lib/masters/submodules";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";

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

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/masters" className="hover:text-primary">
          Master Data
        </Link>{" "}
        / <span className="text-foreground">{sub.label}</span>
      </nav>
      <PageHeader title={sub.label} description={sub.description} />
      {sub.note && (
        <div
          className={
            sub.status === "provisional"
              ? "rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning"
              : "rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted-foreground"
          }
        >
          {sub.note}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sub.children.map((c) => (
          <HubCard
            key={c.slug}
            href={c.type === "link" ? c.href : `/masters/${sub.slug}/${c.slug}`}
            title={c.label}
            subtitle={c.type === "todo" ? "Not set up yet" : c.description}
            external={c.type === "link" && c.external}
            dashed={c.type === "todo"}
          />
        ))}
      </div>
    </div>
  );
}
