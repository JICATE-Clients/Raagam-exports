import { can, requirePermission } from "@/lib/auth/server";
import { getSampleEntryFormData, listSampleEntries } from "@/lib/sales/sample-entry/service";
import { previewSampleNumbers } from "@/lib/sales/sample-entry/actions";
import { today } from "@/lib/calendar";
import { SampleEntryScreen } from "./sample-entry-screen";

/**
 * Sample ▸ Samples & Development ▸ Sample Entry — the list, with the entry
 * editor as an OVERLAY mode of it (raagam-screen-layout, the operator's rule 3).
 * doc/sample/sample-module-specification.md; data model in migration 0683.
 */
export default async function SampleEntryPage() {
  await requirePermission("sales", "view");

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
