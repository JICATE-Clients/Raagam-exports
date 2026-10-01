import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getPoImport, listRecentPoImports, loadPoMasters } from "@/lib/orders/po-import/service";
import { autoMatch } from "@/lib/orders/po-import/seed";
import { anthropicConfigured } from "@/lib/orders/po-import/anthropic";
import { PO_IMPORT_BUCKET } from "@/lib/orders/po-import/types";
import { PoImportScreen } from "./po-import-screen";

/**
 * Upload Buyer PO (doc/order/digitalisation-plan.md §2, 0669) — reached from
 * Order Entry's "Upload Buyer PO" button. Upload → read → review → "Create
 * order" opens Order Entry pre-filled. Nothing here saves an order.
 *
 * `?id=<import>` reopens an upload (the "Recent uploads" strip links here).
 */
export default async function PoImportPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  await requirePermission("orders", "create");
  const sp = await searchParams;
  const id = typeof sp.id === "string" ? sp.id : null;

  const sb = await createClient();
  const [masters, recent, current] = await Promise.all([
    loadPoMasters(sb),
    listRecentPoImports(8),
    id ? getPoImport(id, sb) : Promise.resolve(null),
  ]);

  // The preview link is signed here, for 10 minutes — the bucket is private.
  let previewUrl: string | null = null;
  if (current) {
    const { data } = await sb.storage.from(PO_IMPORT_BUCKET).createSignedUrl(current.storage_path, 600);
    previewUrl = data?.signedUrl ?? null;
  }

  return (
    <PoImportScreen
      key={current?.id ?? "new"}
      configured={anthropicConfigured()}
      masters={masters}
      recent={recent.map((r) => ({ id: r.id, file_name: r.file_name, status: r.status, created_at: r.created_at }))}
      current={
        current
          ? {
              id: current.id,
              file_name: current.file_name,
              mime_type: current.mime_type,
              status: current.status,
              error: current.error,
              // Re-match only what nobody decided — masters may have grown since the read.
              stored: current.extracted ? autoMatch(current.extracted, masters) : null,
              previewUrl,
            }
          : null
      }
    />
  );
}
