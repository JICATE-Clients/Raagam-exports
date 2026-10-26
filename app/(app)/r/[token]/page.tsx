import Link from "next/link";
import { QrCode } from "lucide-react";
import { requireRh } from "@/lib/resolve/auth";
import { getPlaceByToken, listTrades } from "@/lib/resolve/service";
import { findSimilar } from "@/lib/resolve/actions";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { BrokenReportForm } from "@/components/resolve/report/broken-report-form";

/**
 * A QR STICKER SCAN — `/r/<token>`.
 *
 * Inside `app/(app)` on purpose (plan §1): a scan needs a login, and the
 * session gate sends the person back here after it. The token is an
 * unguessable credential for ONE place; it never reveals an id. An unknown or
 * retired sticker gets a plain sentence and a way to report anyway, and a
 * sticker in a unit the person cannot access shows the database's own reason.
 */
export default async function QrScanPage({ params }: { params: Promise<{ token: string }> }) {
  await requireRh("view");
  const { token } = await params;

  let place = null;
  let refusal: string | null = null;
  try {
    place = await getPlaceByToken(token);
  } catch (e) {
    refusal = e instanceof Error ? e.message : "This sticker could not be read.";
  }

  if (!place) {
    return (
      <div className="space-y-4">
        <PageHeader title="Sticker not recognised" back={false} />
        <div className="max-w-[40rem] space-y-3 rounded-lg border border-border p-4">
          <p className="flex items-center gap-2 text-base font-semibold text-foreground">
            <QrCode className="h-5 w-5 text-muted-foreground" aria-hidden />
            This sticker isn&apos;t recognised
          </p>
          <p className="text-sm text-muted-foreground">
            {refusal ??
              "It may have been replaced, or the place it belongs to is no longer in use. You can still report the problem by choosing the place yourself."}
          </p>
          <Link href="/resolve/report/broken" className={buttonClasses({ variant: "primary" })}>
            Report it without the sticker
          </Link>
        </div>
      </div>
    );
  }

  const [trades, similar] = await Promise.all([listTrades(), findSimilar(place.place_id)]);
  const checkedAt = new Date().toISOString();
  return (
    <div className="space-y-4">
      <PageHeader title={`Report a problem at ${place.name}`} back={false} />
      <BrokenReportForm
        places={[]}
        trades={trades.map((t) => ({ id: t.id, name: t.name }))}
        lockedPlace={{
          id: place.place_id,
          name: place.name,
          location_name: place.location_name,
          recent_90d: place.recent_90d,
        }}
        initialSimilar={similar.ok ? similar.data : []}
        initialCheckedAt={checkedAt}
        source="qr"
      />
    </div>
  );
}
