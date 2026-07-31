import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder that mirrors a `MasterListShell`: a filter/search row, a
 * table with a header and several rows, and a pagination strip. Rendered by the
 * master route `loading.tsx` files while the server component fetches data, so
 * the user sees the page's shape immediately instead of a blank screen.
 *
 * The shape itself now lives in `components/ui/skeleton.tsx` as `ListSkeleton`,
 * so the other modules' `loading.tsx` files can use it without importing from
 * the masters folder. This name is kept because the masters routes already call
 * it and it says what those routes mean.
 */
export function MasterListSkeleton({ rows = 8 }: { rows?: number }) {
  return <ListSkeleton rows={rows} />;
}
