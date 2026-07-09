import { MATERIALS_CHILDREN } from "./registry";

/**
 * Master Data top level — the 6 legacy EDP2 "Configure" submodules and, for the
 * five non-Materials areas, their child masters.
 *
 * Materials owns a dedicated route (`/masters/materials`, richer — Attributes is
 * master-detail) so its children live in `registry.ts`. The other five render
 * through the generic `/masters/[submodule]` hub + `[entity]` resolver:
 *   - `link` children point at an existing editor (legacy `?tab=`) or another
 *     module, and simply redirect.
 *   - `todo` children aren't built yet and show a placeholder.
 */
export type SubChild =
  | {
      slug: string;
      label: string;
      singular: string;
      description: string;
      type: "link";
      href: string;
      external?: boolean; // owned by another module (shown with ↗)
    }
  | {
      slug: string;
      label: string;
      singular: string;
      description: string;
      type: "todo";
    }
  | {
      slug: string;
      label: string;
      singular: string;
      description: string;
      type: "custom"; // rich master with its own table + dedicated screen
      custom: string; // dispatch key for /masters/[submodule]/[entity]
    };

export type SubmoduleDef = {
  slug: string;
  label: string;
  description: string;
  status: "ready" | "provisional";
  note?: string;
  children: SubChild[]; // empty for Materials (handled by its own route)
};

export const SUBMODULES: SubmoduleDef[] = [
  {
    slug: "materials",
    label: "Materials",
    description: "Yarn, fabric, trim & specification masters",
    status: "ready",
    children: [],
  },
  {
    slug: "associates",
    label: "Associates",
    description: "Trading partners, parties, banks & accounts",
    status: "ready",
    note: "Legacy Configure ▸ Associates — the 17 children in legacy order. Each is a placeholder until its form is built from the legacy screenshot; some (Customer, Vendor, Employee, Account Head) may map to existing buyers/vendors/staff/gl_accounts tables — backing to be confirmed per child.",
    children: [
      { slug: "country", label: "Country", singular: "Country", description: "Country master", type: "custom", custom: "country" },
      { slug: "port", label: "Port", singular: "Port", description: "Shipping ports", type: "custom", custom: "port" },
      { slug: "destination", label: "Destination", singular: "Destination", description: "Shipment destinations", type: "custom", custom: "destination" },
      { slug: "bank", label: "Bank", singular: "Bank", description: "Bank master", type: "custom", custom: "bank" },
      { slug: "applicant", label: "Applicant", singular: "Applicant", description: "LC / document applicants", type: "custom", custom: "applicant" },
      { slug: "receivable-term", label: "Receivable Term", singular: "Receivable Term", description: "Receivable terms", type: "custom", custom: "receivable_term" },
      { slug: "customer", label: "Customer", singular: "Customer", description: "Customer / buyer master", type: "custom", custom: "customer" },
      { slug: "notify", label: "Notify", singular: "Notify Party", description: "Export notify parties", type: "custom", custom: "notify" },
      { slug: "consignee", label: "Consignee", singular: "Consignee", description: "Export consignees", type: "todo" },
      { slug: "payment-term", label: "Payment Term", singular: "Payment Term", description: "Payment terms", type: "todo" },
      { slug: "vendor", label: "Vendor", singular: "Vendor", description: "Suppliers / vendors", type: "todo" },
      { slug: "employee", label: "Employee", singular: "Employee", description: "Employee master", type: "todo" },
      { slug: "account-group", label: "Account Group", singular: "Account Group", description: "Chart-of-accounts groups", type: "todo" },
      { slug: "account-head", label: "Account Head", singular: "Account Head", description: "Ledger account heads", type: "todo" },
      { slug: "merchandising-team", label: "Merchandising Team", singular: "Merchandising Team", description: "Merchandising teams", type: "todo" },
      { slug: "courier-delivery-address", label: "Courier Delivery Address", singular: "Courier Delivery Address", description: "Courier delivery addresses", type: "todo" },
      { slug: "tcs-assign-to-customers", label: "TCS Assign to Customers", singular: "TCS Assignment", description: "TCS assignment to customers", type: "todo" },
    ],
  },
  {
    slug: "hr",
    label: "HR",
    description: "Designations, departments & classifications",
    status: "ready",
    note: "Most HR classifications are free-text on the staff record today — these masters will formalise them.",
    children: [
      { slug: "designations", label: "Designations", singular: "Designation", description: "Job titles / roles", type: "todo" },
      { slug: "departments", label: "Departments", singular: "Department", description: "Org departments / sections", type: "todo" },
      { slug: "grades", label: "Grades", singular: "Grade", description: "Pay grades / classifications", type: "todo" },
      { slug: "employee-types", label: "Employee Types", singular: "Employee Type", description: "Worker / staff / contract", type: "todo" },
      { slug: "shifts", label: "Shifts", singular: "Shift", description: "Work shifts", type: "todo" },
    ],
  },
  {
    slug: "currencies",
    label: "Currencies",
    description: "Currency master & FX",
    status: "ready",
    note: "Live exchange rates are maintained in Finance — this holds the currency master.",
    children: [
      { slug: "currency", label: "Currency", singular: "Currency", description: "Code · name · symbol", type: "link", href: "/masters?tab=currencies" },
      { slug: "exchange-rate", label: "Exchange Rate", singular: "Exchange Rate", description: "Daily FX rates", type: "link", href: "/finance/exchange-rates", external: true },
    ],
  },
  {
    slug: "gst",
    label: "GST",
    description: "Tax rates & HSN classification",
    status: "ready",
    children: [
      { slug: "gst-rate", label: "GST Rate", singular: "GST Rate", description: "Tax rate slabs", type: "link", href: "/masters?tab=gst-rates" },
      { slug: "hsn-code", label: "HSN Code", singular: "HSN Code", description: "Harmonised commodity codes", type: "todo" },
      { slug: "tax-type", label: "Tax Type", singular: "Tax Type", description: "CGST / SGST / IGST setup", type: "todo" },
    ],
  },
  {
    slug: "system",
    label: "System",
    description: "Company, units, periods & numbering",
    status: "provisional",
    note: "Provisional — several of these may already live in Administration. To be confirmed against legacy Configure ▸ System.",
    children: [
      { slug: "locations", label: "Locations / Units", singular: "Location", description: "Units & offices", type: "todo" },
      { slug: "company", label: "Company", singular: "Company", description: "Legal entity profile", type: "todo" },
      { slug: "financial-years", label: "Financial Years", singular: "Financial Year", description: "Accounting periods", type: "todo" },
      { slug: "number-series", label: "Number Series", singular: "Number Series", description: "Document numbering rules", type: "todo" },
      { slug: "document-terms", label: "Document Terms", singular: "Document Term", description: "Standard terms & conditions", type: "todo" },
    ],
  },
];

export function submoduleChildCount(s: SubmoduleDef): number {
  return s.slug === "materials" ? MATERIALS_CHILDREN.length : s.children.length;
}
export function findSubmodule(slug: string): SubmoduleDef | undefined {
  return SUBMODULES.find((s) => s.slug === slug);
}
export function findSubChild(sub: SubmoduleDef, slug: string): SubChild | undefined {
  return sub.children.find((c) => c.slug === slug);
}
