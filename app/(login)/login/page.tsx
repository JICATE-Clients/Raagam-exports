"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";

/** Field skin for the light-green login (see `app/(login)/layout.tsx`). The
 *  primitive follows the app's light / dark tokens and this screen does not,
 *  so the look is pinned here; everything else `Input` does (autofill opt-in,
 *  caps exemption by type, the required hold) is kept. */
const FIELD =
  "h-12 rounded-[10px] border-[#cfe3b4] bg-white px-3.5 text-[15px] md:text-[15px] font-medium text-[#1b2a12] " +
  "hover:border-[#b5d38f] focus-visible:border-[#5f9418] focus-visible:ring-[3px] focus-visible:ring-[#85c227]/25 " +
  "[&:-webkit-autofill]:[-webkit-text-fill-color:#1b2a12] [&:-webkit-autofill]:shadow-[inset_0_0_0_40px_#ffffff]";
const LABEL = "text-[13px] font-semibold text-[#3d5226]";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // "/start" decides the landing page (role Home page / My Profile / Dashboard);
  // a link that already names a page goes straight there.
  const redirectTo = params.get("redirect") || "/start";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) return setError(error.message);
    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <div className="grid gap-8">
      <div className="flex items-center gap-3">
        <Image
          src="/brand/raagam-mark.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-full"
        />
        <span className="text-base font-extrabold tracking-[0.08em]">
          RAAGAM EXPORTS
        </span>
      </div>

      <div>
        <h1 className="mb-1.5 text-[28px] font-bold">Sign in</h1>
        <p className="text-sm text-[#556b40]">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <form onSubmit={signInPassword} className="grid gap-[18px]">
        {error && (
          <p className="rounded-[10px] bg-[#fde8e8] px-3 py-2.5 text-[13px] text-[#b42318]">
            {error}
          </p>
        )}

        <div className="grid gap-2">
          <label htmlFor="email" className={LABEL}>
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
            required
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className={LABEL}>
              Password
            </label>
            <Link
              href="/forgot-password"
              tabIndex={-1}
              className="text-[13px] font-semibold text-[#4a7a14] hover:underline hover:underline-offset-[3px]"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            {/* caps-input: exempt -- a password is case-sensitive; the reveal toggle turns this into type="text" */}
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              uppercase={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // Edge draws its own reveal eye inside a password box; hide it so
              // only this toggle shows (two eyes, each flipping a different state).
              className={`${FIELD} pr-12 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`}
              required
            />
            <button
              type="button"
              tabIndex={-1}
              // Keep focus (and the caret) in the password box while toggling.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#6b7f58] hover:text-[#1b2a12]"
            >
              {/* The icon shows the CURRENT state: crossed-out while masked,
                  open while visible (user 2026-10-01). */}
              {showPassword ? (
                <Eye className="h-[18px] w-[18px]" />
              ) : (
                <EyeOff className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-1.5 h-12 rounded-[10px] bg-[#4a7a14] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(74,122,20,0.25)] transition hover:bg-[#3f6a10] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#85c227]/40 disabled:cursor-progress disabled:opacity-75"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-xs text-[#6b7f58]">© 2026 Raagam Exports</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
