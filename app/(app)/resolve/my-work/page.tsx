import { PageHeader } from "@/components/ui/page-header";
import { MyWorkScreen } from "@/components/resolve/work/my-work-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listMyWork } from "@/lib/resolve/service";

export default async function MyWorkPage() {
  await requireRh("work");
  // All four queues at once, so each tab shows its count before it is opened.
  const [assigned, in_progress, to_claim, done] = await Promise.all([
    listMyWork("assigned"),
    listMyWork("in_progress"),
    listMyWork("to_claim"),
    listMyWork("done"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="My Work" description="Jobs assigned to you, jobs your teams can claim, and what you have fixed" />
      <MyWorkScreen lists={{ assigned, in_progress, to_claim, done }} />
    </div>
  );
}
