"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { DropdownItem } from "@/components/ui/dropdown-menu";
import { MoreActions } from "@/components/ui/more-actions";
import { useToast } from "@/components/ui/toast";
import { kbFeedback, publishKbArticle, retireKbArticle } from "@/lib/resolve/desk-actions";
import type { KbArticle, OpenServiceCategory } from "@/lib/resolve/desk-types";
import { KbEditorSheet } from "./kb-editor-sheet";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Publish / Edit / Retire for `resolve:edit`, folded into ONE "More" in the
 * article's header (mobile redesign 2026-10-26: a reader's page is the steps
 * and "Did this help?", and the editor's three actions are now-and-then). The
 * database refuses anything the status does not allow; each item only appears
 * where its status allows it, so the menu never offers a refusal.
 */
export function KbArticleMenu({ article, categories }: { article: KbArticle; categories: OpenServiceCategory[] }) {
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

  const items: DropdownItem[] = [
    ...(article.status === "draft"
      ? [{ label: "Publish", icon: Send, disabled: isPending, onClick: () => setConfirm("publish") }]
      : []),
    ...(article.status !== "retired"
      ? [{ label: "Edit", icon: Pencil, disabled: isPending, onClick: () => setEditing(true) }]
      : []),
    ...(article.status === "published"
      ? [{ label: "Retire", icon: Archive, danger: true, disabled: isPending, onClick: () => setConfirm("retire") }]
      : []),
  ];

  return (
    <>
      <MoreActions items={items} label="Article actions" />

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
    </>
  );
}

/**
 * "Did this help? 👍 / 👎" for every reader of a published article — one
 * answer per person, answering again changes it. PINNED to the bottom on a
 * phone (above the tab bar, the Raagam Assist answer bar's offset), so the
 * question waits under the thumb after the last step; an ordinary card from md
 * up.
 */
export function KbFeedbackBar({ article }: { article: KbArticle }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const mine = article.my_feedback;

  function answer(helpful: boolean) {
    startTransition(async () => {
      const res = await kbFeedback(article.id, helpful);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(helpful ? "Thank you — marked as helpful." : "Thank you — the desk will see it did not help.");
      router.refresh();
    });
  }

  if (article.status !== "published") return null;
  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-3 flex items-center gap-2 border-t border-border bg-surface px-3 py-2.5 md:static md:mx-0 md:rounded-xl md:border md:px-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Did this help?</p>
        {mine != null ? <p className="text-xs text-muted-foreground">You can change your answer.</p> : null}
      </div>
      <Button
        type="button"
        variant={mine === true ? "approve" : "outline"}
        aria-pressed={mine === true}
        disabled={isPending}
        onClick={() => answer(true)}
      >
        <ThumbsUp className="h-4 w-4" aria-hidden />
        Yes
      </Button>
      <Button
        type="button"
        variant={mine === false ? "danger" : "outline"}
        aria-pressed={mine === false}
        disabled={isPending}
        onClick={() => answer(false)}
      >
        <ThumbsDown className="h-4 w-4" aria-hidden />
        No
      </Button>
    </div>
  );
}
