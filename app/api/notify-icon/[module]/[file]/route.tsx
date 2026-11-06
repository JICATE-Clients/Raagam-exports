import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { isNotificationModule, moduleLook } from "@/lib/notifications/look";

/**
 * THE POP-UP'S PICTURE (user 2026-11-06, the approved notifications mockup).
 * Windows and Android draw a notification from three strings and one image, in
 * their own font — so the image is the only place the sender's face and the
 * module can reach the operator. This draws both into one 192 px PNG:
 *
 *   /api/notify-icon/approvals/KM-6a4fd6.png?p=<photo>  → photo (or KM on #6a4fd6) + violet badge
 *   /api/notify-icon/approvals/module.png               → the module's icon alone (a sweep, a job)
 *
 * Built by `notificationIconPath()` in lib/notifications/look.ts — never by hand.
 *
 * NO SESSION, BY DESIGN: the path ends in `.png`, which `proxy.ts`'s matcher
 * lets through, because the OS fetches the icon from the service worker. So
 * the route must be safe for anyone to call: it renders only initials and a
 * colour from the path, and a photo ONLY from this project's public storage
 * (`employee-photos`) — any other `?p=` is ignored, so it can never be used to
 * fetch an arbitrary URL from the server.
 */

/*
 * THE BADGE GLYPHS, AS RAW SVG — copied from lucide-react's own `__iconNode`
 * data (the same icons `look.ts` hands the bell). NOT the lucide components:
 * those call `useContext`, and Satori renders JSX without React, so a lucide
 * icon here kills the request with an empty reply (found 2026-11-06).
 */
type Shape = ["path", { d: string }] | ["rect", Record<string, string>] | ["circle", Record<string, string>];
const GLYPHS: Record<string, Shape[]> = {
  approvals: [
    ["path", { d: "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13" }],
    ["path", { d: "M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z" }],
    ["path", { d: "M5 22h14" }],
  ],
  orders: [
    ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1" }],
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M12 11h4" }],
    ["path", { d: "M12 16h4" }],
    ["path", { d: "M8 11h.01" }],
    ["path", { d: "M8 16h.01" }],
  ],
  cad: [
    ["path", { d: "M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" }],
    ["path", { d: "m14.5 12.5 2-2" }],
    ["path", { d: "m11.5 9.5 2-2" }],
    ["path", { d: "m8.5 6.5 2-2" }],
    ["path", { d: "m17.5 15.5 2-2" }],
  ],
  ta: [
    ["path", { d: "M16 14v2.2l1.6 1" }],
    ["path", { d: "M16 2v4" }],
    ["path", { d: "M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" }],
    ["path", { d: "M3 10h5" }],
    ["path", { d: "M8 2v4" }],
    ["circle", { cx: "16", cy: "16", r: "6" }],
  ],
  comms: [
    ["path", { d: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" }],
    ["path", { d: "M8 12h.01" }],
    ["path", { d: "M12 12h.01" }],
    ["path", { d: "M16 12h.01" }],
  ],
  admin: [
    ["path", { d: "M10 15H6a4 4 0 0 0-4 4v2" }],
    ["path", { d: "m14.305 16.53.923-.382" }],
    ["path", { d: "m15.228 13.852-.923-.383" }],
    ["path", { d: "m16.852 12.228-.383-.923" }],
    ["path", { d: "m16.852 17.772-.383.924" }],
    ["path", { d: "m19.148 12.228.383-.923" }],
    ["path", { d: "m19.53 18.696-.382-.924" }],
    ["path", { d: "m20.772 13.852.924-.383" }],
    ["path", { d: "m20.772 16.148.924.383" }],
    ["circle", { cx: "18", cy: "15", r: "3" }],
    ["circle", { cx: "9", cy: "7", r: "4" }],
  ],
  resolve: [
    ["path", { d: "M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" }],
    ["path", { d: "M21 16v2a4 4 0 0 1-4 4h-5" }],
  ],
  logistics: [
    ["path", { d: "M12 10.189V14" }],
    ["path", { d: "M12 2v3" }],
    ["path", { d: "M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" }],
    ["path", { d: "M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76" }],
    ["path", { d: "M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" }],
  ],
};

function Glyph({ module, size, stroke }: { module: string; size: number; stroke: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(GLYPHS[module] ?? GLYPHS.approvals).map(([tag, attrs], i) =>
        tag === "path" ? <path key={i} {...attrs} /> : tag === "rect" ? <rect key={i} {...attrs} /> : <circle key={i} {...attrs} />,
      )}
    </svg>
  );
}

const SIZE = 192;
const BADGE = 76;

function allowedPhoto(p: string | null): string | null {
  if (!p) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const u = new URL(p);
    const own = new URL(base);
    return u.origin === own.origin && u.pathname.startsWith("/storage/v1/object/public/") ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ module: string; file: string }> }) {
  const { module, file } = await params;
  const key = isNotificationModule(module) ? module : "approvals";
  const look = moduleLook(key);

  const m = /^([A-Z0-9]{1,3})-([0-9a-f]{6})\.png$/i.exec(file);
  const initials = m ? decodeURIComponent(m[1]).toUpperCase() : null;
  const tint = m ? `#${m[2]}` : look.hue;
  const photo = m ? allowedPhoto(req.nextUrl.searchParams.get("p")) : null;

  const face = photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image
    <img src={photo} width={SIZE - 16} height={SIZE - 16} style={{ borderRadius: 9999, objectFit: "cover" }} alt="" />
  ) : initials ? (
    <div
      style={{
        width: SIZE - 16,
        height: SIZE - 16,
        borderRadius: 9999,
        background: tint,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 72,
        fontWeight: 700,
        letterSpacing: -2,
      }}
    >
      {initials}
    </div>
  ) : (
    <div
      style={{
        width: SIZE - 16,
        height: SIZE - 16,
        borderRadius: 9999,
        background: look.hue,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Glyph module={key} size={92} stroke={2} />
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: "flex", position: "relative", padding: 8 }}>
        {face}
        {(photo || initials) && (
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: BADGE,
              height: BADGE,
              borderRadius: 9999,
              background: look.hue,
              border: "6px solid #fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Glyph module={key} size={38} stroke={2.4} />
          </div>
        )}
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      // A sender's face changes rarely, and the URL changes with it (the photo is in the query).
      headers: { "Cache-Control": "public, max-age=86400, immutable" },
    },
  );
}
