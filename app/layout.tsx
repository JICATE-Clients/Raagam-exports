import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import { Providers } from "./providers";
import { BugReporterWrapper } from "@/components/bug-reporter-wrapper";

export const metadata: Metadata = {
  title: "Raagam ERP",
  description: "Raagam Exports — garment export ERP",
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
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
