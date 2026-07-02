"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { requestProductDevelopment } from "@/lib/sales/pd-handoff-actions";

export function PdRequestButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await requestProductDevelopment(opportunityId);
          if (r.ok) {
            success("Product development requested → Planning");
            router.refresh();
          } else {
            toastError(r.error);
          }
        })
      }
    >
      {isPending ? "Requesting…" : "Request Product Development"}
    </Button>
  );
}
