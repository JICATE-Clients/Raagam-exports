import { PageHeader } from "@/components/ui/page-header";
import { LogCallScreen, type LogCallArea } from "@/components/resolve/desk/log-call-screen";
import { requireRh } from "@/lib/resolve/auth";
import { getAssistCatalog } from "@/lib/resolve/assist-service";
import { listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { listPeople } from "@/lib/resolve/service";
import { createClient } from "@/lib/supabase/server";

/** `rh_assist_service`'s own fallback when an IT item names no category. */
const DEFAULT_CODE = "HW";

/**
 * Which desk category each catalog item routes to. The catalog RPC does not
 * carry it (the chat routes inside `rh_assist_service`), so it is read here —
 * `rh_catalog_items` is readable with resolve:view (0751). A failed read is an
 * error, not an empty map: an empty map would silently route every call to HW.
 */
async function itemCategoryCodes(): Promise<Map<string, string>> {
  const s = await createClient();
  const { data, error } = await s.from("rh_catalog_items").select("id, sd_category_code").not("sd_category_code", "is", null);
  if (error) throw new Error(`Reading the catalog routing: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: string; sd_category_code: string | null }[]).map((r) => [r.id, r.sd_category_code ?? DEFAULT_CODE]),
  );
}

/** The commonest code among an area's items — where "Something else" goes. */
function commonest(codes: string[]): string {
  const n = new Map<string, number>();
  for (const c of codes) n.set(c, (n.get(c) ?? 0) + 1);
  let best = DEFAULT_CODE;
  let top = 0;
  for (const [c, k] of n) if (k > top) [best, top] = [c, k];
  return best;
}

// Logging on behalf needs resolve:edit (plan §1.8); `rh_sd_submit` checks it again.
export default async function LogCallPage() {
  await requireRh("work");
  const [categories, people, catalog, codes] = await Promise.all([
    listOpenServiceCategories(),
    listPeople(),
    getAssistCatalog(),
    itemCategoryCodes(),
  ]);
  const areas: LogCallArea[] = catalog
    .filter((a) => a.lane === "it")
    .map((a) => {
      const items = a.items.map((i) => ({
        id: i.id,
        label: i.label,
        dangerous: i.dangerous,
        category_code: codes.get(i.id) ?? DEFAULT_CODE,
      }));
      return { id: a.id, label: a.label, icon: a.icon, items, other_code: commonest(items.map((i) => i.category_code)) };
    });

  return (
    <div className="space-y-4">
      <PageHeader title="Log a Call" description="Raise an IT request for someone on the phone, email, chat or WhatsApp" />
      {categories.length === 0 ? (
        <p className="max-w-[40rem] rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No service category is switched on in this unit.{" "}
          {"Add one under Resolve Hub ▸ Administration ▸ Service Categories first."}
        </p>
      ) : (
        <LogCallScreen categories={categories} people={people} areas={areas} />
      )}
    </div>
  );
}
