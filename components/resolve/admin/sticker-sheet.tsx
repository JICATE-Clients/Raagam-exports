"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { markQrPrinted } from "@/lib/resolve/actions";

export type Sticker = { id: string; name: string; code: string; unit: string; url: string; image: string };

/**
 * The sticker cards, three to a row on A4. Print opens the browser's print
 * dialog and THEN records `qr_printed_at` — a sticker sheet merely opened is
 * not a sticker on a wall. The cards carry `.report-print-area`, the app's one
 * print isolation (app/globals.css): everything else is hidden on paper.
 *
 * That area is absolutely positioned and does not paginate (globals.css says
 * so), so a sheet is ONE page — twelve stickers. More than that are refused
 * here rather than silently clipped.
 */
const PER_PAGE = 12;
export function StickerSheet({ stickers }: { stickers: Sticker[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();

  function print() {
    window.print();
    startTransition(async () => {
      const res = await markQrPrinted(stickers.map((s) => s.id));
      if (res.ok) {
        success(stickers.length === 1 ? "Sticker marked printed." : `${stickers.length} stickers marked printed.`);
        router.refresh();
      } else error(res.error);
    });
  }

  if (stickers.length > PER_PAGE) {
    return (
      <p className="text-sm text-danger">
        {stickers.length} places ticked — one sheet holds {PER_PAGE}. Go back and print them in batches of {PER_PAGE}.
      </p>
    );
  }
  if (!stickers.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No sticker to print — tick places that have a QR on Places &amp; QR, then choose Print stickers.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <Button disabled={isPending} onClick={print}>
          <Printer aria-hidden />
          Print {stickers.length === 1 ? "sticker" : `${stickers.length} stickers`}
        </Button>
        <span className="text-sm text-muted-foreground">Printing records the date on each place.</span>
      </div>
      <div className="report-print-area grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-3">
        {stickers.map((s) => (
          <figure
            key={s.id}
            className="flex break-inside-avoid flex-col items-center gap-2 rounded-lg border border-border bg-white p-4 text-center text-black"
          >
            <figcaption className="text-xs font-semibold uppercase tracking-wide">Something broken? Scan to report</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn on the server; next/image adds nothing */}
            <img src={s.image} alt={`QR code for ${s.name}`} className="h-40 w-40" />
            <span className="text-base font-bold leading-tight">{s.name}</span>
            <span className="font-mono text-xs">
              {s.code}
              {s.unit ? ` · ${s.unit}` : ""}
            </span>
          </figure>
        ))}
      </div>
    </div>
  );
}
