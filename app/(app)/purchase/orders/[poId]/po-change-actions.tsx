"use client";

import { useRouter } from "next/navigation";
import { Ban, IndianRupee } from "lucide-react";
import { MoreActions } from "@/components/ui/more-actions";

/**
 * An approved PO's two changes, both decided by the MD in My Approvals (0785):
 * a revised line rate, and cancelling the whole PO or part of its lines. Each
 * opens its own screen on this PO; nothing on the PO moves until the approve.
 */
export function PoChangeActions({ poId }: { poId: string }) {
  const router = useRouter();
  return (
    <MoreActions
      items={[
        {
          label: "Amend rate",
          icon: IndianRupee,
          onClick: () => router.push(`/purchase/rate-amendments?po=${poId}`),
        },
        {
          label: "Request cancellation",
          icon: Ban,
          danger: true,
          onClick: () => router.push(`/purchase/po-cancellations?po=${poId}`),
        },
      ]}
    />
  );
}
