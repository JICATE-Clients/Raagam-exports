import { z } from "zod";

export interface OrderCoordinateColor {
  id: string;
  sales_order_id: string;
  style_ref_no: string | null;
  style_no: string | null;
  combo: string | null;
  sno: number;
  coordinate: string;
  color: string | null;
}

export interface OrderDescription {
  id: string;
  sales_order_id: string;
  style_ref_no: string | null;
  style_no: string | null;
  sno: number;
  description_type: string | null;
  description: string | null;
}

export interface OrderTrim {
  id: string;
  sales_order_id: string;
  style_ref_no: string | null;
  style_no: string | null;
  sno: number;
  category: string | null;
  trims_specifications: string | null;
  supply_type: string | null;
  vendor_name: string | null;
}

export interface OrderFabric {
  id: string;
  sales_order_id: string;
  style_ref_no: string | null;
  style_no: string | null;
  combo: string | null;
  sno: number;
  structure_name: string | null;
  fabric_type: string | null;
  composition: string | null;
  gsm: number | null;
  gsm_tolerance: number | null;
  item_sub_type: string | null;
  other_details: string | null;
  components: OrderFabricComponent[];
}

export interface OrderFabricComponent {
  id: string;
  order_fabric_id: string;
  sno: number;
  coordinate: string | null;
  component: string | null;
  fabric_color: string | null;
  fabric_print: string | null;
  specifications: string | null;
  other_details: string | null;
  processed_as_trim: boolean;
  fabric_name: string | null;
}

export interface OrderApprovalParam {
  id: string;
  sales_order_id: string;
  sno: number;
  parameter_name: string;
  status: string | null;
  comment: string | null;
  is_user_defined: boolean;
}

export const SUPPLY_TYPES = ["nominated", "recommended", "foc_csp", "foc_ssp", "purchase", "csp_purchase", "none"] as const;
export const DESCRIPTION_TYPES = ["printing", "embroidery", "packing"] as const;
export const FABRIC_ITEM_SUBTYPES = ["solid", "melange", "yarn_dyed"] as const;
export const APPROVAL_PARAM_STATUSES = ["ok", "not_ok"] as const;

export const coordinateColorInput = z.object({
  sales_order_id: z.string().uuid(),
  style_ref_no: z.string().optional().nullable(),
  coordinate: z.string().min(1),
  color: z.string().optional().nullable(),
  combo: z.string().optional().nullable(),
});

export const orderDescriptionInput = z.object({
  sales_order_id: z.string().uuid(),
  style_ref_no: z.string().optional().nullable(),
  description_type: z.enum(DESCRIPTION_TYPES).optional().nullable(),
  description: z.string().optional().nullable(),
});

export const orderTrimInput = z.object({
  sales_order_id: z.string().uuid(),
  style_ref_no: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  trims_specifications: z.string().optional().nullable(),
  supply_type: z.enum(SUPPLY_TYPES).optional().nullable(),
  vendor_name: z.string().optional().nullable(),
});

export const orderFabricInput = z.object({
  sales_order_id: z.string().uuid(),
  style_ref_no: z.string().optional().nullable(),
  combo: z.string().optional().nullable(),
  structure_name: z.string().optional().nullable(),
  fabric_type: z.enum(["main", "trims_fabric"]).optional().nullable(),
  composition: z.string().optional().nullable(),
  gsm: z.coerce.number().optional().nullable(),
  gsm_tolerance: z.coerce.number().optional().nullable(),
  item_sub_type: z.enum(FABRIC_ITEM_SUBTYPES).optional().nullable(),
  other_details: z.string().optional().nullable(),
});

export const approvalParamInput = z.object({
  sales_order_id: z.string().uuid(),
  parameter_name: z.string().min(1),
  status: z.enum(APPROVAL_PARAM_STATUSES).optional().nullable(),
  comment: z.string().optional().nullable(),
  is_user_defined: z.boolean().default(false),
});
