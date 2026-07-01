import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getExport } from "@/lib/integration/service";
import { EXPORT_TYPE_LABELS } from "@/lib/integration/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { StatusTone } from "@/components/ui/status-pill";
import { DownloadButton } from "./download-button";

const statusTone: Record<"generated" | "failed", StatusTone> = {
  generated: "success",
  failed: "danger",
};

export default async function ExportDetailPage({
  params,
}: {
  params: Promise<{ exportId: string }>;
}) {
  const { exportId } = await params;
  await requirePermission("integration", "view");

  const exp = await getExport(exportId);
  if (!exp) notFound();

  const period =
    [exp.period_start, exp.period_end].filter(Boolean).join(" → ") || "—";

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={exp.code ?? "Export Detail"}
        description={`${EXPORT_TYPE_LABELS[exp.export_type] ?? exp.export_type} — ${period}`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/integration/tally"
              className="text-sm text-muted-foreground hover:underline"
            >
              Back to Tally
            </Link>
            {exp.xml_content && (
              <DownloadButton
                xmlContent={exp.xml_content}
                filename={`${exp.code ?? exportId}.xml`}
              />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardBody>
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="mt-1">
              <StatusPill tone={statusTone[exp.status]}>{exp.status}</StatusPill>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-muted-foreground">Records</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {fmtNumber(exp.record_count)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-muted-foreground">Exported Items</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {fmtNumber(exp.item_count)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-muted-foreground">Generated</p>
            <p className="mt-1 text-sm font-medium">{fmtDate(exp.created_at)}</p>
          </CardBody>
        </Card>
      </div>

      {exp.error_message && (
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-red-600">{exp.error_message}</p>
          </CardBody>
        </Card>
      )}

      {exp.xml_content && (
        <Card>
          <CardHeader>
            <CardTitle>XML Preview</CardTitle>
          </CardHeader>
          <CardBody>
            <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all bg-muted/40 rounded p-3">
              {exp.xml_content.slice(0, 2000)}
              {exp.xml_content.length > 2000 && (
                "\n\n… (truncated — download for full content)"
              )}
            </pre>
          </CardBody>
        </Card>
      )}

      {!exp.xml_content && exp.status !== "failed" && (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">No XML content available.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
