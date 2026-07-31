import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found — Raagam ERP" };

/**
 * The catch-all for URLs that match no route in the app.
 *
 * Deliberately plain and dependency-free, in the same spirit as
 * `app/offline/page.tsx`: this renders under the ROOT layout only, so there is
 * no shell, no permission context, and no guarantee the visitor is signed in —
 * a mistyped URL is just as likely to arrive from a logged-out tab. Anything
 * that assumes a session would throw and turn a 404 into a 500.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-lg">
        R
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">
          Page not found
        </h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          The address you opened doesn&apos;t match anything in Raagam ERP.
          Check the link, or start again from the dashboard.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm active:scale-95"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
