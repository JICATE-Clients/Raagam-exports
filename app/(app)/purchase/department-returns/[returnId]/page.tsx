import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getDepartmentReturn,
  getReturnableRequisitions,
  getReturnBins,
} from "@/lib/stores/department-return-service";
import { DepartmentReturnEditor } from "../_components/department-return-editor";

export default async function DepartmentReturnPage({ params }: { params: Promise<{ returnId: string }> }) {
  await requirePermission("stores", "view");
  const { returnId } = await params;
  const found = await getDepartmentReturn(returnId);
  if (!found) notFound();
  const [requisitions, bins, canEdit] = await Promise.all([
    getReturnableRequisitions(found.doc.material_requisition_id),
    getReturnBins(),
    can("stores", "edit"),
  ]);
  return (
    <DepartmentReturnEditor
      doc={found.doc}
      lines={found.lines}
      requisitions={requisitions}
      bins={bins}
      canEdit={canEdit}
      canPost={canEdit}
    />
  );
}
