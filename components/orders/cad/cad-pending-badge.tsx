import { CAD_PENDING_NOTE, CAD_PENDING_TITLE } from "@/lib/orders/cad-lifecycle/stamp";

/**
 * The on-screen / printed "CAD PENDING" mark on a Fabric BOM report — a bordered
 * red badge, not a faint watermark (see `lib/orders/cad-lifecycle/stamp.ts` for
 * why). Same words as the PDF stamp.
 */
export function CadPendingBadge() {
  return (
    <div
      role="note"
      className="border-2 border-[#b3261e] bg-[#fdf3f2] px-3 py-1.5 text-center text-[#b3261e]"
    >
      <div className="text-[12px] font-bold uppercase tracking-[.14em]">{CAD_PENDING_TITLE}</div>
      <div className="text-[11px]">{CAD_PENDING_NOTE}</div>
    </div>
  );
}
