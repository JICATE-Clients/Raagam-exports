"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { withdrawTracked } from "./actions";

/** Withdraw, confirmed first — it ends the complaint and cannot be undone. */
export function WithdrawButton({ token }: { token: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={isPending}>
        Withdraw this complaint
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <ConfirmDialog
        open={open}
        title="Withdraw this complaint?"
        body="The handler stops working on it and it is closed as withdrawn. This cannot be undone — you would need to send a new complaint."
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        tone="danger"
        isPending={isPending}
        onConfirm={() =>
          startTransition(async () => {
            const res = await withdrawTracked(token);
            setOpen(false);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setError(null);
            router.refresh();
          })
        }
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
