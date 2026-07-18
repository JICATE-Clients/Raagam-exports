import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { IndentApproval, IndentApprovalItem, IndentConversion, IndentConversionItem } from "./indent-types";

export type IndentApprovalRow = IndentApproval & { indent_code: string | null };

export async function listIndentApprovals(): Promise<IndentApprovalRow[]> {
  const s = await createClient();
  const { data } = await s.from("indent_approvals").select("*, purchase_indents(code)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, indent_code: (row.purchase_indents as { code: string } | null)?.code ?? null } as unknown as IndentApprovalRow;
  });
}

export async function getIndentApprovalItems(approvalId: string): Promise<IndentApprovalItem[]> {
  const s = await createClient();
  const { data } = await s.from("indent_approval_items").select("*").eq("indent_approval_id", approvalId).order("sno");
  return (data ?? []) as IndentApprovalItem[];
}

export type IndentConversionRow = IndentConversion & { indent_code: string | null };

export async function listIndentConversions(): Promise<IndentConversionRow[]> {
  const s = await createClient();
  const { data } = await s.from("indent_conversions").select("*, purchase_indents(code)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return { ...row, indent_code: (row.purchase_indents as { code: string } | null)?.code ?? null } as unknown as IndentConversionRow;
  });
}

export async function getIndentConversionItems(conversionId: string): Promise<IndentConversionItem[]> {
  const s = await createClient();
  const { data } = await s.from("indent_conversion_items").select("*").eq("conversion_id", conversionId).order("sno");
  return (data ?? []) as IndentConversionItem[];
}
