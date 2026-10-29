"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { applyTripEvent } from "@/lib/logistics/transport/actions";
import { MANUAL_ACTION_LABEL, canTransition, manualNextStatus } from "@/lib/logistics/transport/logic";
import type { TripStatus } from "@/lib/logistics/transport/types";

/**
 * The trip's manual status steps — the Fleet Board's button, on the document.
 * Through `applyTripEvent`, the one door the GPS webhook also uses (plan D6).
 *
 * The Complete step is NOT here: completing means entering costs, which is the
 * form on the page. Cancel stays only while the goods have not left the origin
 * (`canTransition` — the same table the server enforces).
 */
export function TripActions({ tripId, status }: { tripId: string; status: TripStatus }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const next = manualNextStatus(status);
  const step = next && next !== "completed" ? next : null;
  const cancellable = canTransition(status, "cancelled");

  function go(to: TripStatus) {
    if (to === "cancelled" && !window.confirm("Cancel this trip? Its requests go back to the pending pool.")) return;
    start(async () => {
      const res = await applyTripEvent(tripId, to);
      if (res.ok) {
        success(MANUAL_ACTION_LABEL[to] ?? "Updated");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  if (!step && !cancellable) return null;
  return (
    <>
      {cancellable && (
        <Button variant="outline" size="md" disabled={isPending} onClick={() => go("cancelled")}>
          {MANUAL_ACTION_LABEL.cancelled}
        </Button>
      )}
      {step && (
        <Button size="md" disabled={isPending} onClick={() => go(step)}>
          {isPending ? "Saving…" : MANUAL_ACTION_LABEL[step]}
        </Button>
      )}
    </>
  );
}
