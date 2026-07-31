"use client";

import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * Last line of defence: the root layout itself threw.
 *
 * This file REPLACES `app/layout.tsx` when it renders, which is why it declares
 * its own `<html>`/`<body>` and re-imports `globals.css` — none of the root
 * layout's setup has run. In practice it fires only for failures in the layout
 * chain above `(app)` (auth bootstrap, the Supabase client, the providers);
 * anything thrown inside a screen is caught one level down by `(app)/error.tsx`,
 * which keeps the shell and is a far better experience.
 *
 * No `Card`/`Button` imports and no `metadata` export here on purpose: metadata
 * is unsupported in a client component, and pulling the design system into the
 * boundary that exists precisely because the app failed to boot is how a broken
 * page becomes a blank one. Plain markup and the raw stylesheet only.
 *
 * A full reload rather than `unstable_retry()`: a root layout that threw has no
 * intact React tree worth re-rendering into, so re-running the whole boot is
 * both simpler and likelier to work.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <title>Something went wrong — Raagam ERP</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger text-2xl font-bold text-white shadow-lg">
            !
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-foreground">
              Raagam ERP couldn&apos;t start
            </h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              This is usually temporary. Reload to try again — if it keeps
              happening, quote the reference below to your administrator.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm active:scale-95"
          >
            Reload
          </button>
          {error.digest ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
