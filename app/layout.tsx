import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { BugReporterWrapper } from "@/components/bug-reporter-wrapper";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SilentUpdater } from "@/components/pwa/silent-updater";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

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
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/*
         * Applies the stored theme before first paint. A raw inline <script> —
         * not next/script — because only inline-in-head is guaranteed to run
         * synchronously ahead of paint, which is the entire point: anything
         * later means a white flash on every load for dark-mode users.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
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
