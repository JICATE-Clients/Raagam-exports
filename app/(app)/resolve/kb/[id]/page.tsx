import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRh, canRh } from "@/lib/resolve/auth";
import { getKbArticle, listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { KB_STATUS_LABEL } from "@/lib/resolve/desk-types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { KbSteps } from "@/components/resolve/kb/kb-steps";
import { KbArticleMenu, KbFeedbackBar } from "@/components/resolve/kb/kb-article-actions";
import { kbStatusTone } from "@/components/resolve/kb/kb-status";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-3 md:p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/**
 * One article, read on a phone first (mobile redesign 2026-10-26): the title,
 * its category, the problem, the numbered steps, the tags — then "Did this
 * help?" pinned at the foot. Publish / Edit / Retire sit in one "More" in the
 * header for `resolve:edit`.
 *
 * RLS decides who reads it (`rh_kb_get`: published to everyone in Resolve Hub,
 * any status to `resolve:edit`); one the viewer may not read is a 404, exactly
 * like one that does not exist.
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
  const answers = article.helpful_count + article.not_helpful_count;
  const helpful = answers > 0 ? Math.round((article.helpful_count / answers) * 100) : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title={`${article.code} — ${article.title}`}
        actions={canEdit ? <KbArticleMenu article={article} categories={categories} /> : undefined}
      />
      <div className="max-w-[48rem] space-y-3">
        <div className="space-y-1.5">
          <p className="text-lg font-semibold leading-6 text-foreground">{article.title}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-foreground">{category}</span>
            {canEdit || article.status !== "published" ? (
              <StatusPill tone={kbStatusTone(article.status)}>{KB_STATUS_LABEL[article.status]}</StatusPill>
            ) : null}
            <span className="font-mono">{article.code}</span>
            <span className="tabular-nums">
              used {article.used_count}×{helpful != null ? ` · ${helpful}% helpful` : ""}
            </span>
          </div>
        </div>

        <Section title="The problem">
          <p className="whitespace-pre-wrap text-sm text-foreground">{article.problem}</p>
        </Section>
        <Section title="Steps">
          <KbSteps steps={article.steps} />
        </Section>
        {article.tags.length > 0 ? (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {article.tags.map((t) => (
                <StatusPill key={t} tone="neutral">
                  {t}
                </StatusPill>
              ))}
            </div>
          </Section>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Written by {article.author_name ?? "—"}
          {article.published_at ? ` · published ${fmtDate(article.published_at)}` : ""}
          {canEdit && article.source_ticket_id ? (
            <>
              {" · "}
              <Link href={`/resolve/tickets/${article.source_ticket_id}`} className="text-primary hover:underline">
                from the resolved request
              </Link>
            </>
          ) : null}
        </p>

        <KbFeedbackBar article={article} />
      </div>
    </div>
  );
}
