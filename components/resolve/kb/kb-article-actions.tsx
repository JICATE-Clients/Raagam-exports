"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { kbFeedback, publishKbArticle, retireKbArticle } from "@/lib/resolve/desk-actions";
import type { KbArticle, OpenServiceCategory } from "@/lib/resolve/desk-types";
import { KbEditorSheet } from "./kb-editor-sheet";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The article's client half: "Did this help?" for every reader of a published
 * article (one answer per person — answering again changes it), and Edit /
 * Publish / Retire for `resolve:edit`. Publishing is the one filled button
 * while it is a draft; the database refuses anything the status does not allow.
 */
export function KbArticleActions({
  article,
  canEdit,
  categories,
}: {
  article: KbArticle;
  canEdit: boolean;
  categories: OpenServiceCategory[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "retire" | null>(null);

  function run(call: () => Promise<Result>, done: string) {
    startTransition(async () => {
      const res = await call();
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setConfirm(null);
      success(done);
      router.refresh();
    });
  }

  const mine = article.my_feedback;

  return (
    <div className="space-y-4">
      {article.status === "published" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Did this help?</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mine === true ? "approve" : "outline"}
              aria-pressed={mine === true}
              disabled={isPending}
              onClick={() => run(() => kbFeedback(article.id, true), "Thank you — marked as helpful.")}
            >
              <ThumbsUp className="h-4 w-4" aria-hidden />
              Yes
            </Button>
            <Button
              type="button"
              variant={mine === false ? "danger" : "outline"}
              aria-pressed={mine === false}
              disabled={isPending}
              onClick={() => run(() => kbFeedback(article.id, false), "Thank you — the desk will see it did not help.")}
            >
              <ThumbsDown className="h-4 w-4" aria-hidden />
              No
            </Button>
          </div>
          {mine != null ? <p className="text-xs text-muted-foreground">You can change your answer.</p> : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {article.status === "draft" ? (
            <Button type="button" disabled={isPending} onClick={() => setConfirm("publish")}>
              <Send className="h-4 w-4" aria-hidden />
              Publish
            </Button>
          ) : null}
          {article.status !== "retired" ? (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Button>
          ) : null}
          {article.status === "published" ? (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setConfirm("retire")}>
              <Archive className="h-4 w-4" aria-hidden />
              Retire
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <KbEditorSheet
          draft={{
            id: article.id,
            title: article.title,
            problem: article.problem,
            steps: article.steps,
            tags: article.tags,
            category_code: article.category_code,
            source_ticket_id: article.source_ticket_id,
          }}
          categories={categories}
          onClose={() => setEditing(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm === "publish"}
        title={`Publish ${article.code}?`}
        body="Requesters will be shown it while they type a request, and technicians on matching tickets."
        confirmLabel="Publish"
        cancelLabel="Not yet"
        tone="primary"
        isPending={isPending}
        onConfirm={() => run(() => publishKbArticle(article.id), "Published.")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "retire"}
        title={`Retire ${article.code}?`}
        body="It stops being suggested. Tickets that used it keep their link, and it stays under Retired."
        confirmLabel="Retire"
        cancelLabel="Keep it"
        tone="danger"
        isPending={isPending}
        onConfirm={() => run(() => retireKbArticle(article.id), "Retired.")}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
