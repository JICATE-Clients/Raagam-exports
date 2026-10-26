import type { Metadata } from "next";
import Image from "next/image";
import { TrackLookupForm } from "./track-lookup-form";

/**
 * /p/track — follow an anonymous complaint. PUBLIC (`proxy.ts` stands down for
 * `/p/`, and this sits outside `app/(app)`): an anonymous complainant has no
 * account link to their complaint, only the private link they were shown once.
 * This page only turns a pasted link into `/p/track/<token>`; it looks nothing up.
 */

export const metadata: Metadata = {
  title: "Track a concern — Raagam Exports",
  robots: { index: false, follow: false },
};

export default function TrackPage() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <header className="text-center">
          <Image
            src="/brand/raagam-wordmark.png"
            alt="Raagam Exports"
            width={431}
            height={184}
            priority
            className="mx-auto h-12 w-auto"
          />
        </header>
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h1 className="text-lg font-semibold">Track a concern</h1>
          <p className="text-sm text-muted-foreground">
            Paste the private link you were shown when you raised an anonymous concern. It shows where
            it stands and the reply — nothing about who sent it.
          </p>
          <TrackLookupForm />
          <p className="text-xs text-muted-foreground">
            Lost the link? It cannot be recovered — it was only ever shown once, and we do not know
            who sent it. You can raise a new one, and mention the old reference number.
            Concerns raised with your name are under My Reports after you sign in.
          </p>
        </section>
      </div>
    </main>
  );
}
