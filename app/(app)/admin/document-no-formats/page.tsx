import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDocumentNoFormats } from "@/lib/masters/document-no-format-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { DocumentNoFormatMasterScreen } from "@/components/masters/document-no-format-master-screen";
import { can } from "@/lib/auth/server";

export default async function AdminDocumentNoFormatsPage() {
  await requirePermission("system_admin", "view");
  const [formats, all] = await Promise.all([listDocumentNoFormats(), listConfigLookups()]);
  const [canCreate, canEdit, canDelete, canExport, isSuperAdmin] = await Promise.all([
    can("masters", "create"),
    can("masters", "edit"),
    can("masters", "delete"),
    can("masters", "export"),
    can("system_admin", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Document No Format"
        description="Document numbering formats."
      />
      <DocumentNoFormatMasterScreen
        rows={formats}
        trackOptions={all.filter((l) => l.kind === "doc_track")}
        menuOptions={all.filter((l) => l.kind === "doc_menu")}
        valueTypeOptions={all.filter((l) => l.kind === "doc_value_type")}
        valueFromOptions={all.filter((l) => l.kind === "doc_value_from")}
        perms={{ canCreate, canEdit, canDelete }}
      />
    </div>
  );
}
