"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";

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
    <Card>
      <CardBody className="space-y-4">
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <form onSubmit={signInPassword} className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                tabIndex={-1}
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                // caps-input: exempt -- a password is case-sensitive; the reveal toggle turns this into type="text"
                uppercase={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                // Edge draws its own reveal eye inside a password box; hide it so
                // only this toggle shows (two eyes, each flipping a different state).
                className="pr-9 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
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
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {/* The icon shows the CURRENT state: crossed-out while masked,
                    open while visible (user 2026-10-01). */}
                {showPassword ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
