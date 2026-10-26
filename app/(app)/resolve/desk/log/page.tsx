import { PageHeader } from "@/components/ui/page-header";
import { LogCallScreen } from "@/components/resolve/desk/log-call-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listOpenServiceCategories } from "@/lib/resolve/desk-service";
import { listPeople } from "@/lib/resolve/service";

// Logging on behalf needs resolve:edit (plan §1.8); `rh_sd_submit` checks it again.
export default async function LogCallPage() {
  await requireRh("work");
  const [categories, people] = await Promise.all([listOpenServiceCategories(), listPeople()]);
  return (
    <div className="space-y-4">
      <PageHeader title="Log a Call" description="Raise an IT request for someone on the phone, email, chat or WhatsApp" />
      {categories.length === 0 ? (
        <p className="max-w-[37rem] rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No service category is switched on in this unit.{" "}
          {"Add one under Resolve Hub ▸ Administration ▸ Service Categories first."}
        </p>
      ) : (
        <LogCallScreen categories={categories} people={people} />
      )}
    </div>
  );
}
