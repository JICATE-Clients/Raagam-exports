// Tally Prime XML export builders.
// Produces a credible Tally "Import Data" ENVELOPE for vouchers. The exact
// ledger names and voucher classes may need tuning to the client's Tally company
// setup (see ASSUMPTIONS.md), but the structure is valid Tally XML.

export function xmlEscape(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ISO date (YYYY-MM-DD) → Tally date (YYYYMMDD). Falls back to today-ish blank. */
export function tallyDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10).replace(/-/g, "");
}

function num(n: number | null | undefined): string {
  return (n ?? 0).toFixed(2);
}

interface VoucherInput {
  voucherType: string; // "Sales" | "Purchase Order" | "Sales Order" | "Payment"
  date: string | null;
  voucherNumber: string | null;
  partyLedger: string;
  /** ledger entries: positive amount = debit side intent handled by isPositive */
  entries: { ledger: string; amount: number; isDeemedPositive: boolean }[];
  narration?: string | null;
}

function voucher(v: VoucherInput): string {
  const entries = v.entries
    .map(
      (e) => `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${xmlEscape(e.ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${e.isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${e.isDeemedPositive ? "-" : ""}${num(Math.abs(e.amount))}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`,
    )
    .join("");

  return `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${xmlEscape(v.voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${tallyDate(v.date)}</DATE>
        <VOUCHERTYPENAME>${xmlEscape(v.voucherType)}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${xmlEscape(v.voucherNumber)}</VOUCHERNUMBER>
        <PARTYLEDGERNAME>${xmlEscape(v.partyLedger)}</PARTYLEDGERNAME>
        <NARRATION>${xmlEscape(v.narration)}</NARRATION>${entries}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

function envelope(messages: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>${messages.join("")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// ---------- row shapes (the service fetches & maps to these) ----------
export interface SalesInvoiceRow {
  date: string | null;
  voucherNumber: string | null;
  party: string;
  amount: number; // INR
  narration?: string | null;
}
export interface CustomerOrderRow {
  date: string | null;
  voucherNumber: string | null;
  party: string;
  amount: number;
}
export interface PurchaseOrderRow {
  date: string | null;
  voucherNumber: string | null;
  party: string;
  amount: number;
}
export interface SupplierPaymentRow {
  date: string | null;
  voucherNumber: string | null;
  party: string;
  amount: number;
  bankLedger?: string;
}

// ---------- public builders (each returns a full ENVELOPE) ----------
export function buildSalesInvoicesXml(rows: SalesInvoiceRow[]): string {
  return envelope(
    rows.map((r) =>
      voucher({
        voucherType: "Sales",
        date: r.date,
        voucherNumber: r.voucherNumber,
        partyLedger: r.party,
        narration: r.narration,
        entries: [
          { ledger: r.party, amount: r.amount, isDeemedPositive: true }, // Dr debtor
          { ledger: "Export Sales", amount: r.amount, isDeemedPositive: false }, // Cr sales
        ],
      }),
    ),
  );
}

export function buildCustomerOrdersXml(rows: CustomerOrderRow[]): string {
  return envelope(
    rows.map((r) =>
      voucher({
        voucherType: "Sales Order",
        date: r.date,
        voucherNumber: r.voucherNumber,
        partyLedger: r.party,
        entries: [
          { ledger: r.party, amount: r.amount, isDeemedPositive: true },
          { ledger: "Export Sales", amount: r.amount, isDeemedPositive: false },
        ],
      }),
    ),
  );
}

export function buildPurchaseOrdersXml(rows: PurchaseOrderRow[]): string {
  return envelope(
    rows.map((r) =>
      voucher({
        voucherType: "Purchase Order",
        date: r.date,
        voucherNumber: r.voucherNumber,
        partyLedger: r.party,
        entries: [
          { ledger: "Material Purchases", amount: r.amount, isDeemedPositive: true }, // Dr purchases
          { ledger: r.party, amount: r.amount, isDeemedPositive: false }, // Cr creditor
        ],
      }),
    ),
  );
}

export function buildSupplierPaymentsXml(rows: SupplierPaymentRow[]): string {
  return envelope(
    rows.map((r) =>
      voucher({
        voucherType: "Payment",
        date: r.date,
        voucherNumber: r.voucherNumber,
        partyLedger: r.party,
        entries: [
          { ledger: r.party, amount: r.amount, isDeemedPositive: true }, // Dr creditor
          {
            ledger: r.bankLedger ?? "Bank - Account 1",
            amount: r.amount,
            isDeemedPositive: false,
          }, // Cr bank
        ],
      }),
    ),
  );
}
