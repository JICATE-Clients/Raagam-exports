"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { postJournal, reverseJournal } from "@/lib/finance/gl-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function PostButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  const router = useRouter();

  function handlePost() {
    startTransition(async () => {
      const result = await postJournal(entryId);
      if (result.ok) {
        success("Journal entry posted.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <Button size="sm" onClick={handlePost} disabled={isPending}>
      {isPending ? "Posting…" : "Post"}
    </Button>
  );
}

export function ReverseButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  const router = useRouter();

  function handleReverse() {
    if (!confirm("Create a reversal journal entry? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await reverseJournal(entryId);
      if (result.ok) {
        success("Reversal journal created. Original marked as reversed.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <Button variant="danger" size="sm" onClick={handleReverse} disabled={isPending}>
      {isPending ? "Reversing…" : "Reverse"}
    </Button>
  );
}
