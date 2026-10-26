import { headers } from "next/headers";
import QRCode from "qrcode";
import { PageHeader } from "@/components/ui/page-header";
import { StickerSheet, type Sticker } from "@/components/resolve/admin/sticker-sheet";
import { getCurrentLocation } from "@/lib/auth/location";
import { requireRh } from "@/lib/resolve/auth";
import { listPlaces } from "@/lib/resolve/service";

/**
 * Printable QR stickers for the places ticked on Places & QR. The code is drawn
 * HERE, on the server, from the place's random token — the token never goes
 * through a third-party QR service. The URL is the deployment that printed it
 * (the request's own host), so a sticker printed from production opens
 * production.
 */
export default async function StickersPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  await requireRh("admin");
  const { ids = "" } = await searchParams;
  const wanted = new Set(ids.split(",").filter(Boolean));
  const [places, { location }, h] = await Promise.all([listPlaces(), getCurrentLocation(), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const stickers: Sticker[] = await Promise.all(
    places
      .filter((p) => wanted.has(p.id) && p.qr_token)
      .map(async (p) => {
        const url = `${origin}/r/${p.qr_token}`;
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          unit: location?.name ?? "",
          url,
          image: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 360 }),
        };
      }),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="QR Stickers"
        description="Print, cut and stick one on each place — scanning it opens the report form for that place"
        back={{ href: "/resolve/setup/places", label: "Places & QR" }}
      />
      <StickerSheet stickers={stickers} />
    </div>
  );
}
