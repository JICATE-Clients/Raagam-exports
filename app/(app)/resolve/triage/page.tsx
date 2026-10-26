import { PageHeader } from "@/components/ui/page-header";
import { TriageScreen } from "@/components/resolve/work/triage-screen";
import { requestNow } from "@/components/resolve/work/queue-clock";
import { requireRh } from "@/lib/resolve/auth";
import { getTriageQueue, listPeople } from "@/lib/resolve/service";

export default async function TriagePage() {
  await requireRh("triage");
  const [decide, open, all, people] = await Promise.all([
    getTriageQueue("decide"),
    getTriageQueue("open"),
    getTriageQueue("all"),
    listPeople(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Triage Queue" description="Highest score first — tap a score to see what earned it" />
      <TriageScreen lists={{ decide, open, all }} people={people} nowMs={requestNow()} />
    </div>
  );
}
