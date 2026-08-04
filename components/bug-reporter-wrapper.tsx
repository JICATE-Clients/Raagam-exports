"use client";

import { BugReporterProvider } from "@boobalan_jkkn/bug-reporter-sdk";
import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { bugReporterConfigured } from "@/lib/bug-reporter";

const apiKey = process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY;
const apiUrl = process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL;

/**
 * The SDK only mounts when real credentials are present. The test moved to
 * `lib/bug-reporter.ts` when the topbar's "My bug reports" link needed the same
 * answer: the widget and that link must appear and disappear together, or the
 * menu offers a portal for an app the platform has never heard of. Until
 * `.env.local` is filled this renders children untouched, so the ERP is
 * unaffected — unchanged behaviour, one owner.
 */
const configured = bugReporterConfigured;

/**
 * Wraps the app with the JKKN Bug Reporter, seeding the signed-in Supabase user
 * as report context. Mounted app-wide in the root layout.
 */
export function BugReporterWrapper({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (mounted) setUser(data.user);
      })
      .catch(() => {
        if (mounted) setUser(null);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!configured) return <>{children}</>;

  return (
    <BugReporterProvider
      apiKey={apiKey!}
      apiUrl={apiUrl!}
      enabled={true}
      debug={process.env.NODE_ENV === "development"}
      userContext={
        user
          ? {
              userId: user.id,
              name:
                (user.user_metadata?.full_name as string | undefined) ||
                user.email?.split("@")[0] ||
                "User",
              email: user.email ?? undefined,
            }
          : undefined
      }
    >
      {children}
    </BugReporterProvider>
  );
}
