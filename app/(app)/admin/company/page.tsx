import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getCompanyProfile } from "@/lib/admin/company-service";
import { CompanyProfileScreen } from "@/components/admin/company-profile-screen";

export default async function AdminCompanyPage() {
  await requirePermission("system_admin", "view");
  const profile = await getCompanyProfile();
  const canEdit = await can("system_admin", "edit");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Company Profile"
        description="Legal entity details, registration numbers and export certifications."
      />
      <CompanyProfileScreen profile={profile} canEdit={canEdit} />
    </div>
  );
}
