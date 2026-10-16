import { redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { getSampleEntryFormData, listSampleEntries } from "@/lib/sales/sample-entry/service";
import { previewSampleNumbers } from "@/lib/sales/sample-entry/actions";
import { today } from "@/lib/calendar";
import { SampleEntryScreen } from "./sample-entry-screen";

/**
 * Sample ▸ Samples & Development ▸ Sample Entry — the list, with the entry
 * editor rendered instead of it as a page mount (Order Entry's shape).
 * doc/sample/sample-module-specification.md; data model in migration 0683.
 */
export default async function SampleEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  await requirePermission("sales", "view");

  // `?pd=<request>` — an old approvals-inbox link from when PD Requests were
  // raised here per SMP (0719). They are per SWO now (0723) and live on the
  // Sample Department's queue, so that is where the link lands.
  const pd = (await searchParams).pd;
  if (typeof pd === "string" && pd) redirect(`/sales/pd-acknowledge?open=${encodeURIComponent(pd)}`);

  const [rows, data, canCreate, canEdit, canDelete, masterCreate, masterEdit, preview] = await Promise.all([
    listSampleEntries(),
    getSampleEntryFormData(),
    can("sales", "create"),
    can("sales", "edit"),
    can("sales", "delete"),
    // The pickers' quick-add writes a MASTER row (country, agent, ship type…),
    // so it follows the masters grant, not the sales one.
    can("masters", "create"),
    can("masters", "edit"),
    // Today's next Enquiry No, so a new entry's box is filled on first paint.
    previewSampleNumbers(today(), 0),
  ]);

  return (
    <SampleEntryScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: masterCreate, canEdit: masterEdit }}
      nextEnquiryNo={preview.enquiryNo}
    />
  );
}
