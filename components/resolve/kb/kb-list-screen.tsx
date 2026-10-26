"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { PaginationBar } from "@/components/ui/pagination";
import { ToggleGroup } from "@/components/ui/segmented";
import { ROUTE_LOOK } from "@/components/resolve/chat/assist";
import { usePagination } from "@/lib/use-pagination";
import { KB_STATUS_LABEL, type KbListRow, type KbStatus, type OpenServiceCategory } from "@/lib/resolve/desk-types";
import { cn } from "@/lib/utils";
import { KbEditorSheet } from "./kb-editor-sheet";

const EMPTY: Record<KbStatus, string> = {
  published: "No published articles yet. They are written from resolved IT requests.",
  draft: "No drafts waiting to be published.",
  retired: "Nothing has been retired.",
};

/** The "All" chip — no category code is ever this. */
const ALL = "__all__";

/** "92% helpful" — only once somebody has answered. */
function helpfulText(r: KbListRow): string | null {
  const answers = r.helpful_count + r.not_helpful_count;
  return answers > 0 ? `${Math.round((r.helpful_count / answers) * 100)}% helpful` : null;
}

/**
 * THE KNOWLEDGE BASE (service-desk-plan §6) — published articles for everyone;
 * Drafts and Retired for `resolve:edit`, whose chip is a URL (`?status=`) so
 * the server reads that list (`rh_kb_list` refuses the other two to anyone
 * else).
 *
 * A READABLE LIST, NOT A NUMBER TABLE (mobile redesign 2026-10-26): each row is
 * the title, its category chip and step count, and "used 14× · 92% helpful" —
 * the two things a reader picks a fix by. Category chips across the top narrow
 * it; search filters the rows already on screen, at once. Paged like every
 * listing, on the app-wide page size.
 */
export function KbListScreen({
  rows,
  status,
  canEdit,
  categories,
}: {
  rows: KbListRow[];
  status: KbStatus;
  canEdit: boolean;
  categories: OpenServiceCategory[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);
  const catName = useMemo(() => new Map(categories.map((c) => [c.code, c.name])), [categories]);

  // Only the categories that have an article on this list — a chip that can
  // only ever show nothing is a dead end.
  const usedCats = useMemo(() => {
    const codes = [...new Set(rows.map((r) => r.category_code).filter((c): c is string => !!c))];
    return codes.sort((a, b) => (catName.get(a) ?? a).localeCompare(catName.get(b) ?? b));
  }, [rows, catName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (cat === ALL || r.category_code === cat) &&
        (!q ||
          [r.code, r.title, r.problem, r.category_code, ...(r.tags ?? [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, search, cat]);
  const pg = usePagination(filtered);
  const showCreated = hasCreatedInfo(rows);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Knowledge Base"
        description="Fixes the desk has written down — search before raising a request"
        actions={
          canEdit ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search fixes — tally, printer offline"
        leading={
          canEdit ? (
            <ToggleGroup<KbStatus>
              label="Articles"
              role="tablist"
              value={status}
              onChange={(s) => router.push(s === "published" ? "/resolve/kb" : `/resolve/kb?status=${s}`)}
              options={(["published", "draft", "retired"] as const).map((s) => ({ value: s, label: KB_STATUS_LABEL[s] }))}
            />
          ) : undefined
        }
      />
      {usedCats.length > 1 ? (
        <ToggleGroup<string>
          label="Category"
          value={cat}
          onChange={setCat}
          className="max-w-full"
          options={[
            { value: ALL, label: "All" },
            ...usedCats.map((c) => ({ value: c, label: catName.get(c) ?? c })),
          ]}
        />
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {search.trim() || cat !== ALL ? "No articles match that search." : EMPTY[status]}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {pg.paged.map((r) => {
            const helpful = helpfulText(r);
            return (
              <li key={r.id}>
                <Link
                  href={`/resolve/kb/${r.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    className={cn("flex size-8 flex-none items-center justify-center rounded-lg", ROUTE_LOOK.it.tile)}
                    aria-hidden
                  >
                    <BookOpen className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-sm font-medium leading-5 text-foreground">{r.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-foreground">
                        {r.category_code ? (catName.get(r.category_code) ?? r.category_code) : "Any"}
                      </span>
                      <span className="tabular-nums">
                        {r.step_count} step{r.step_count === 1 ? "" : "s"}
                      </span>
                      <span className="font-mono">{r.code}</span>
                      {showCreated ? <span>{createdMeta(r)}</span> : null}
                    </span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-0.5 text-right text-xs tabular-nums">
                    <span className="text-foreground">used {r.used_count}×</span>
                    {helpful ? <span className="font-medium text-success">{helpful}</span> : null}
                  </span>
                  <ChevronRight className="size-4 flex-none text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {creating ? (
        <KbEditorSheet
          draft={{ title: "", problem: "", steps: [], tags: [], category_code: null, source_ticket_id: null }}
          categories={categories}
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/resolve/kb/${id}`)}
        />
      ) : null}
    </div>
  );
}
