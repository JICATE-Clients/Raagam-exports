"use client";

import { SimpleMasterScreen, type SimpleMasterDescriptor } from "@/components/masters/simple-master-screen";
import { createCmtProcess, updateCmtProcess, deleteCmtProcess } from "@/lib/masters/cmt-process-actions";
import { CMT_STAGES, CMT_STAGE_LABEL, type CmtProcess, type CmtStage } from "@/lib/masters/cmt-process-types";
import { CMT_PROCESS_NAMES } from "@/lib/masters/name-vocabularies";
import { FIELD_WIDTH } from "@/components/ui/field";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const STAGE_OPTIONS = CMT_STAGES.map((st) => ({ value: st, label: CMT_STAGE_LABEL[st] }));

/** A blank rate is "no standard rate"; anything typed must be a figure ≥ 0. */
function rateOf(v: string | boolean | undefined): number | null {
  const t = String(v ?? "").trim();
  return t ? Number(t) : null;
}

/**
 * CMT Process master (0735) — Master Data ▸ Materials ▸ CMT Processes.
 *
 * The garment floor's own operations, each under one of the five production
 * stages (Cutting · Sewing · Checking · Ironing · Packing). A master of its own,
 * not a kind of Process (user 2026-10-17: "CMT is separate process not inside
 * process"). Sample Costing ▸ CMT operations narrows its operation picker to the
 * stage picked beside it, and pre-fills a blank rate from Standard Rate.
 *
 * Three fields, so it joins the inline `SimpleMasterScreen` tier with Components.
 */
const descriptor: SimpleMasterDescriptor<CmtProcess> = {
  entityLabel: "CMT Process",
  status: "active",
  blockEntity: "cmt_process",
  fields: [
    {
      key: "cmt_stage",
      label: "Stage",
      kind: "select",
      required: true,
      options: STAGE_OPTIONS,
      widthClass: FIELD_WIDTH.code, // 144px — CHECKING, the longest stage word
    },
    {
      key: "name",
      label: "Operation",
      required: true,
      widthClass: FIELD_WIDTH.term, // 176px — SIZE STICKERING, THREAD TRIMMING
    },
    {
      key: "standard_rate",
      label: "Standard Rate ₹/pc",
      widthClass: FIELD_WIDTH.range, // 112px — a ₹/piece figure
    },
  ],
  mobileTitleKey: "name",
  fromRow: (r) => ({
    cmt_stage: r.cmt_stage,
    name: r.name,
    standard_rate: r.standard_rate == null ? "" : String(r.standard_rate),
  }),
  searchText: (r) => [r.name, CMT_STAGE_LABEL[r.cmt_stage]].join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  extraFilters: [
    {
      key: "stage",
      label: "Stage",
      options: STAGE_OPTIONS,
      predicate: (r, v) => r.cmt_stage === v,
    },
  ],
  validate: (v) => {
    const rate = rateOf(v.standard_rate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) return "Standard rate must be a figure of 0 or more.";
    return null;
  },
  toPayload: (v, s) => ({
    cmt_stage: String(v.cmt_stage) as CmtStage,
    name: String(v.name),
    standard_rate: rateOf(v.standard_rate),
    inactive: !s.active,
  }),
  spellSuggest: { seed: CMT_PROCESS_NAMES },
  dupCheck: { table: "cmt_processes", fieldKey: "name" },
  actions: { create: createCmtProcess, update: updateCmtProcess, remove: deleteCmtProcess },
};

export function CmtProcessMasterScreen({ rows, perms }: { rows: CmtProcess[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
