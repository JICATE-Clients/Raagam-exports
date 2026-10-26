import { requireRh, canRh } from "@/lib/resolve/auth";
import { listKbArticles, listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { KB_STATUSES, type KbStatus } from "@/lib/resolve/desk-types";
import { KbListScreen } from "@/components/resolve/kb/kb-list-screen";

/**
 * Resolve Hub ▸ Service Desk ▸ Knowledge Base. Everyone with Resolve Hub reads
 * the published articles; `resolve:edit` also sees Drafts and Retired and
 * writes new ones. A status the viewer may not list falls back to Published
 * rather than erroring — the chip is a URL anyone can type. The header (with
 * "+ New") is drawn by the client screen, which owns the editor sheet.
 */
export default async function KnowledgeBasePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRh("view");
  const [{ status: asked }, canEdit] = await Promise.all([searchParams, canRh("work")]);
  const status: KbStatus =
    canEdit && (KB_STATUSES as readonly string[]).includes(asked ?? "") ? (asked as KbStatus) : "published";
  const [rows, categories] = await Promise.all([listKbArticles(status), listOpenServiceCategories()]);

  return <KbListScreen rows={rows} status={status} canEdit={canEdit} categories={categories} />;
}
