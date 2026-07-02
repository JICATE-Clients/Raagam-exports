import type { Metadata, Viewport } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import { Providers } from "./providers";
import { BugReporterWrapper } from "@/components/bug-reporter-wrapper";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { UpdatePrompt } from "@/components/pwa/update-prompt";

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <BugReporterWrapper>
          <Providers>{children}</Providers>
        </BugReporterWrapper>
        <InstallPrompt />
        <UpdatePrompt />
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
