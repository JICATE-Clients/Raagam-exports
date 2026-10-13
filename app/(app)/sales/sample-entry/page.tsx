import { redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getSampleEntryFormData, listSampleEntries } from "@/lib/sales/sample-entry/service";
import { previewSampleNumbers } from "@/lib/sales/sample-entry/actions";
import { today } from "@/lib/calendar";
import { SampleEntryScreen } from "./sample-entry-screen";

/**
 * Sample ▸ Samples & Development ▸ Sample Entry — the list, with the entry
 * editor as an OVERLAY mode of it (raagam-screen-layout, the operator's rule 3).
 * doc/sample/sample-module-specification.md; data model in migration 0683.
 */
export default async function SampleEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  await requirePermission("sales", "view");

  // `?pd=<request>` — the approvals inbox's row link (WORKFLOWS.sample_pd_request):
  // its subject is the PD REQUEST, so resolve it to the enquiry and open that.
  const pd = (await searchParams).pd;
  if (typeof pd === "string" && pd) {
    const s = await createClient();
    const { data } = await s.from("sample_pd_requests").select("opportunity_id").eq("id", pd).maybeSingle();
    const opp = (data as { opportunity_id: string } | null)?.opportunity_id;
    redirect(opp ? `/sales/sample-entry?open=${opp}` : "/sales/sample-entry");
  }

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
