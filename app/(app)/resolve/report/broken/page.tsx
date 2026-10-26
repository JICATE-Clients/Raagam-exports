import Link from "next/link";
import { canRh, requireRh } from "@/lib/resolve/auth";
import { listReportablePlaces, listTrades } from "@/lib/resolve/service";
import { findSimilar } from "@/lib/resolve/actions";
import { PageHeader } from "@/components/ui/page-header";
import { BrokenReportForm } from "@/components/resolve/report/broken-report-form";

/**
 * SOMETHING IS BROKEN. `?place=<id>` pre-selects a place (a link from a place
 * list); the sticker door is `/r/<token>`, which locks the place instead.
 * `?source=qr` is accepted for links that carry it, but a sticker scan is only
 * ever recorded as `qr` from `/r/` — a hand-typed query string is not a scan.
 */
export default async function BrokenReportPage({
  searchParams,
}: {
  searchParams: Promise<{ place?: string; source?: string }>;
}) {
  await requireRh("view");
  const [{ place }, places, trades, isAdmin] = await Promise.all([
    searchParams,
    listReportablePlaces(),
    listTrades(),
    canRh("admin"),
  ]);

  // A pre-chosen place shows its open reports on first paint, not after a round trip.
  const startPlace = places.find((p) => p.id === place)?.id ?? "";
  const similar = startPlace ? await findSimilar(startPlace) : null;
  const checkedAt = new Date().toISOString();

  return (
    <div className="space-y-4">
      <PageHeader title="Something is broken" back={{ href: "/resolve/report", label: "Report a problem" }} />
      {/* No places yet is NOT a dead end: the form asks "Where is it?" instead
          and the report is routed as needs-sorting. Only an admin can fix the
          list, so only an admin is pointed at it. */}
      {places.length === 0 && isAdmin ? (
        <p className="max-w-[40rem] rounded-lg border border-border p-3 text-sm text-muted-foreground">
          No places are set up for this unit yet, so reporters type where the problem is.{" "}
          <Link href="/resolve/setup/places" className="font-medium text-primary hover:underline">
            Set up places
          </Link>{" "}
          to give them a list (and QR stickers).
        </p>
      ) : null}
      <BrokenReportForm
        places={places}
        trades={trades.map((t) => ({ id: t.id, name: t.name }))}
        initialPlaceId={startPlace}
        initialSimilar={similar?.ok ? similar.data : []}
        initialCheckedAt={checkedAt}
        source="form"
      />
    </div>
  );
}
