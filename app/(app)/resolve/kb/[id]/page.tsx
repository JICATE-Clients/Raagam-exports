import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRh, canRh } from "@/lib/resolve/auth";
import { getKbArticle, listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { KB_STATUS_LABEL } from "@/lib/resolve/desk-types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { KbSteps } from "@/components/resolve/kb/kb-steps";
import { KbArticleActions } from "@/components/resolve/kb/kb-article-actions";
import { kbStatusTone } from "@/components/resolve/kb/kb-status";

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * One article. RLS decides who reads it (`rh_kb_get`: published to everyone
 * in Resolve Hub, any status to `resolve:edit`); one the viewer may not read
 * is a 404, exactly like one that does not exist.
 */
export default async function KbArticlePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRh("view");
  const { id } = await params;
  const [article, canEdit] = await Promise.all([getKbArticle(id), canRh("work")]);
  if (!article) notFound();
  const categories = canEdit || article.category_code ? await listOpenServiceCategories() : [];
  const category = article.category_code
    ? (categories.find((c) => c.code === article.category_code)?.name ?? article.category_code)
    : "Any";

  return (
    <div className="space-y-4">
      <PageHeader title={`${article.code} — ${article.title}`} />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 max-w-[48rem] flex-1 space-y-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Pair label="Status">
              <StatusPill tone={kbStatusTone(article.status)}>{KB_STATUS_LABEL[article.status]}</StatusPill>
            </Pair>
            <Pair label="Category">{category}</Pair>
            <Pair label="Written by">{article.author_name ?? "—"}</Pair>
            <Pair label="Published">{article.published_at ? fmtDate(article.published_at) : "—"}</Pair>
            <Pair label="Used to resolve">
              <span className="tabular-nums">{article.used_count}</span> request{article.used_count === 1 ? "" : "s"}
            </Pair>
            <Pair label="Helpful">
              <span className="tabular-nums">
                {article.helpful_count} yes · {article.not_helpful_count} no
              </span>
            </Pair>
            {canEdit && article.source_ticket_id ? (
              <Pair label="Written from">
                <Link href={`/resolve/tickets/${article.source_ticket_id}`} className="text-primary hover:underline">
                  The resolved request
                </Link>
              </Pair>
            ) : null}
          </dl>

          <section className="space-y-2 border-t border-border pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Problem</h2>
            <p className="whitespace-pre-wrap text-sm text-foreground">{article.problem}</p>
          </section>
          <section className="space-y-2 border-t border-border pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
            <KbSteps steps={article.steps} />
          </section>
          {article.tags.length > 0 ? (
            <section className="space-y-2 border-t border-border pt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</h2>
              <div className="flex flex-wrap gap-1.5">
                {article.tags.map((t) => (
                  <StatusPill key={t} tone="neutral">
                    {t}
                  </StatusPill>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <aside className="w-full space-y-2 lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
          <KbArticleActions article={article} canEdit={canEdit} categories={categories} />
        </aside>
      </div>
    </div>
  );
}
