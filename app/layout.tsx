import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Inter, Roboto, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { BugReporterWrapper } from "@/components/bug-reporter-wrapper";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SilentUpdater } from "@/components/pwa/silent-updater";
import { APPEARANCE_INIT_SCRIPT, appearanceCss } from "@/lib/appearance";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { TYPE_SCALE_INIT_SCRIPT } from "@/lib/type-scale";

/**
 * Inter, self-hosted by `next/font/google` (no runtime request to Google,
 * no layout-shift flash — the font file ships with the build). Swapped in
 * from Archivo 2026-09-08 for a narrower, UI-grade face with real tabular
 * figures — Archivo's wider proportions were fighting the field-width work
 * (see `raagam-field-width-and-type-scale`). The 2026-09-07 "Archivo weight
 * spec" (600/700 hierarchy on buttons, labels, table headers) is a weight
 * decision, not a typeface one, and carries over unchanged onto Inter.
 *
 * ONLY THE FIVE WEIGHTS THE TYPOGRAPHY SYSTEM USES (400/500/600/700/800), per
 * the standing rule against introducing arbitrary weights the design system
 * doesn't call for. `variable` feeds `--font-inter`, which `globals.css`
 * points `--font-sans` at — so this is the ONE place the app's typeface is
 * named; nothing else hardcodes "Inter".
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * The appearance themes' faces (lib/appearance.ts, the topbar "T" menu).
 * `preload: false` is what keeps them free for everyone on the default theme:
 * next/font still declares the @font-face, but the browser fetches a file only
 * when a rule actually USES that family — so only an operator who picked
 * Carbon ever downloads Plex. Variable fonts, so no weight list: one file
 * covers every weight the type scale asks for.
 * Fluent's Segoe UI is a Windows system face and needs no loader.
 */
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
  preload: false,
});
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
  display: "swap",
  preload: false,
});
const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Raagam ERP",
  description: "Raagam Exports — garment export ERP",
  applicationName: "Raagam ERP",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Raagam" },
  icons: { apple: "/icons/apple-touch-icon-180x180.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required, not defensive: THEME_INIT_SCRIPT
    // mutates <html>'s className before React hydrates, so the server markup
    // and the live DOM legitimately differ on this one element.
    <html
      lang="en"
      className={`h-full antialiased ${inter.variable} ${plex.variable} ${sourceSans.variable} ${roboto.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * Applies the stored theme before first paint. A raw inline <script> —
         * not next/script — because only inline-in-head is guaranteed to run
         * synchronously ahead of paint, which is the entire point: anything
         * later means a white flash on every load for dark-mode users.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Compact text, applied pre-paint for the same no-flash reason. */}
        <script dangerouslySetInnerHTML={{ __html: TYPE_SCALE_INIT_SCRIPT }} />
        {/* Appearance theme (font + blue), same pre-paint reason; its
            stylesheet is generated from the one registry in lib/appearance.ts. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: appearanceCss() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <BugReporterWrapper>
          <Providers>{children}</Providers>
        </BugReporterWrapper>
        <InstallPrompt />
        <SilentUpdater />
      </body>
    </html>
  );
}
