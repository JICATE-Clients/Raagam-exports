"use client";

import { useTransition } from "react";
import { postGrn } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function PostGrnButton({ grnId }: { grnId: string }) {
  const [isPending, startTransition] = useTransition();
  const { success, error } = useToast();

  function handlePost() {
    startTransition(async () => {
      const result = await postGrn(grnId);
      if (result.ok) {
        success("GRN posted successfully");
      } else {
        error(result.error);
      }
    });
  }

  return (
    <Button onClick={handlePost} disabled={isPending}>
      {isPending ? "Posting…" : "Post GRN"}
    </Button>
  );
}
