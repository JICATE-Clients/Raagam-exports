import type { ReactNode } from "react";
import Image from "next/image";
import { Urbanist } from "next/font/google";

/**
 * THE LOGIN SCREEN'S OWN SHELL (user 2026-10-01, the "Forest Simple" design).
 *
 * A route group of its own rather than `(auth)`: that layout centres a 384px
 * column under the wordmark, which is right for Register / Set password /
 * Forgot password and leaves no room for a split screen. The URL is still
 * `/login` — a route group never appears in the path.
 *
 * One deliberate look: a light tint of the logo green (#85c227) is the brand
 * surface here (user 2026-10-01, "Raagam colour, light green"), not a theme,
 * so it does not follow the app's light / dark tokens. The photo is on
 * the left with a soft curve (on a phone it sits on top, curving at the
 * bottom), the form on the right.
 */
const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${urbanist.className} grid flex-1 grid-rows-[auto_1fr] bg-[#f1f8e6] text-[#1b2a12] antialiased [color-scheme:light] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:grid-rows-1`}
    >
      <section
        aria-label="Raagam Exports warehouse"
        className="relative aspect-[16/10] max-h-[300px] overflow-hidden bg-[#22322a] [clip-path:ellipse(140%_100%_at_50%_0%)] md:aspect-auto md:max-h-none md:min-h-dvh md:[clip-path:ellipse(100%_120%_at_0%_50%)]"
      >
        <Image
          src="/brand/login-hero.jpg"
          alt="Workers loading yarn cones and fabric bales onto a Raagam Exports truck at the warehouse dock"
          fill
          priority
          sizes="(min-width: 768px) 55vw, 100vw"
          className="object-cover object-[42%_center]"
        />
      </section>
      <main className="flex items-start justify-center px-4 pt-5 pb-8 md:items-center md:px-6 md:py-12">
        <div className="w-full max-w-[340px]">{children}</div>
      </main>
    </div>
  );
}
