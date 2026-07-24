import { cn } from "@/lib/utils";

/**
 * Loading placeholder block — a pulsing muted rectangle. Compose several to
 * mirror the shape of the content that's loading (checklist "Loading
 * Improvements": show skeletons instead of blank screens). Purely presentational
 * and server-renderable, so it works in Next.js `loading.tsx` files.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}
