import type { ReactNode } from "react";
import Image from "next/image";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* THE WORDMARK IS THE HEADING (client 2026-08-21). An <img> inside
              the <h1>, carrying the name as its `alt` — the established way to
              let artwork be a page's title without losing the heading landmark
              or repeating the name in text beside it. The old block was an
              indigo square with a letter "R" above an "Raagam ERP" / "Raagam
              Exports" pair, which said the brand three times and drew none of
              it.

              `h-14 w-auto`, so the aspect ratio is the file's and the layout
              never squashes it; at 431x184 that is ~131px wide inside a 384px
              column. `priority`, because on the login page this IS the largest
              contentful paint. */}
          <h1 className="mb-2">
            <Image
              src="/brand/raagam-wordmark.png"
              alt="Raagam Exports"
              width={431}
              height={184}
              priority
              className="mx-auto h-14 w-auto"
            />
          </h1>
          <p className="text-xs text-muted-foreground">Garment export ERP</p>
        </div>
        {children}
      </div>
    </div>
  );
}
