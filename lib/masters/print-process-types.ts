import { z } from "zod";

// ============================================================================
// Print Processes — master (print_processes). At least one process type flag
// must be checked (is_yarn_process, is_fabric_process, is_cmt_process,
// is_trims_process, is_pieces_process).
// ============================================================================
export interface PrintProcess {
  id: string;
  code: string;
  name: string;
  is_yarn_process: boolean;
  is_fabric_process: boolean;
  is_cmt_process: boolean;
  is_trims_process: boolean;
  is_pieces_process: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const PRINT_PROCESS_FLAGS: { key: keyof PrintProcess; label: string }[] = [
  { key: "is_yarn_process", label: "Yarn" },
  { key: "is_fabric_process", label: "Fabric" },
  { key: "is_cmt_process", label: "CMT" },
  { key: "is_trims_process", label: "Trims" },
  { key: "is_pieces_process", label: "Pieces" },
];

export const printProcessInput = z
  .object({
    /** Blank on create → the action auto-generates a unique code from the name
     *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
     *  code through unchanged. */
    code: z.string().optional().default(""),
    name: z.string().min(1, "Name is required"),
    is_yarn_process: z.boolean().default(false),
    is_fabric_process: z.boolean().default(false),
    is_cmt_process: z.boolean().default(false),
    is_trims_process: z.boolean().default(false),
    is_pieces_process: z.boolean().default(false),
    is_active: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (
      !d.is_yarn_process &&
      !d.is_fabric_process &&
      !d.is_cmt_process &&
      !d.is_trims_process &&
      !d.is_pieces_process
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["is_yarn_process"],
        message: "At least one process type must be selected",
      });
    }
  });
export type PrintProcessInput = z.infer<typeof printProcessInput>;
