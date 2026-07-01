"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { tallyExportInput } from "@/lib/integration/types";
import type { ExportType } from "@/lib/integration/types";
import {
  buildSalesInvoicesXml,
  buildCustomerOrdersXml,
  buildPurchaseOrdersXml,
  buildSupplierPaymentsXml,
} from "@/lib/integration/tally";
import {
  getSalesInvoiceRows,
  getCustomerOrderRows,
  getPurchaseOrderRows,
  getSupplierPaymentRows,
} from "@/lib/integration/service";

type ActionResult = { ok: true; exportId: string } | { ok: false; error: string };

interface ExportBuildResult {
  xmlContent: string;
  recordCount: number;
  entityIds: { entity_type: string; entity_id: string }[];
}

async function buildAllExport(
  periodStart: string | null,
  periodEnd: string | null
): Promise<ExportBuildResult> {
  const [si, co, po, sp] = await Promise.all([
    getSalesInvoiceRows(periodStart, periodEnd),
    getCustomerOrderRows(periodStart, periodEnd),
    getPurchaseOrderRows(periodStart, periodEnd),
    getSupplierPaymentRows(periodStart, periodEnd),
  ]);
  return {
    xmlContent: [
      buildSalesInvoicesXml(si.rows),
      buildCustomerOrdersXml(co.rows),
      buildPurchaseOrdersXml(po.rows),
      buildSupplierPaymentsXml(sp.rows),
    ].join("\n"),
    recordCount: si.rows.length + co.rows.length + po.rows.length + sp.rows.length,
    entityIds: [...si.entityIds, ...co.entityIds, ...po.entityIds, ...sp.entityIds],
  };
}

async function buildSingleExport(
  exportType: Exclude<ExportType, "all">,
  periodStart: string | null,
  periodEnd: string | null
): Promise<ExportBuildResult> {
  if (exportType === "sales_invoices") {
    const { rows, entityIds } = await getSalesInvoiceRows(periodStart, periodEnd);
    return { xmlContent: buildSalesInvoicesXml(rows), recordCount: rows.length, entityIds };
  }
  if (exportType === "customer_orders") {
    const { rows, entityIds } = await getCustomerOrderRows(periodStart, periodEnd);
    return { xmlContent: buildCustomerOrdersXml(rows), recordCount: rows.length, entityIds };
  }
  if (exportType === "purchase_orders") {
    const { rows, entityIds } = await getPurchaseOrderRows(periodStart, periodEnd);
    return { xmlContent: buildPurchaseOrdersXml(rows), recordCount: rows.length, entityIds };
  }
  // supplier_payments
  const { rows, entityIds } = await getSupplierPaymentRows(periodStart, periodEnd);
  return { xmlContent: buildSupplierPaymentsXml(rows), recordCount: rows.length, entityIds };
}

export async function generateTallyExport(rawInput: unknown): Promise<ActionResult> {
  const parse = tallyExportInput.safeParse(rawInput);
  if (!parse.success) {
    return { ok: false, error: parse.error.issues[0]?.message ?? "Invalid input" };
  }
  if (!(await can("integration", "create"))) {
    return { ok: false, error: "Forbidden" };
  }

  const { export_type, period_start, period_end } = parse.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let built: ExportBuildResult;
  try {
    built =
      export_type === "all"
        ? await buildAllExport(period_start ?? null, period_end ?? null)
        : await buildSingleExport(
            export_type,
            period_start ?? null,
            period_end ?? null
          );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Export build failed";
    await supabase.from("tally_exports").insert({
      export_type,
      period_start: period_start ?? null,
      period_end: period_end ?? null,
      format: "xml",
      record_count: 0,
      status: "failed",
      error_message: errorMessage,
      xml_content: null,
      created_by: user?.id ?? null,
    });
    revalidatePath("/integration");
    revalidatePath("/integration/tally");
    return { ok: false, error: errorMessage };
  }

  const { data: exportRecord, error: insertError } = await supabase
    .from("tally_exports")
    .insert({
      export_type,
      period_start: period_start ?? null,
      period_end: period_end ?? null,
      format: "xml",
      record_count: built.recordCount,
      status: "generated",
      xml_content: built.xmlContent,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (insertError || !exportRecord) {
    return { ok: false, error: insertError?.message ?? "Failed to save export" };
  }

  if (built.entityIds.length > 0) {
    await supabase.from("tally_export_items").insert(
      built.entityIds.map((e) => ({
        export_id: exportRecord.id,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        exported_at: new Date().toISOString(),
      }))
    );
  }

  await writeAudit({
    action: "tally_export",
    entityType: "tally_export",
    entityId: exportRecord.id,
    metadata: {
      export_type,
      period_start: period_start ?? null,
      period_end: period_end ?? null,
      record_count: built.recordCount,
    },
  });

  revalidatePath("/integration");
  revalidatePath("/integration/tally");

  return { ok: true, exportId: exportRecord.id };
}
