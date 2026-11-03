/**
 * Who a General DC went to: the vendor's name, else the typed party, else a dash.
 *
 * ITS OWN FILE, NOT `general-dc-service.ts`, because a CLIENT form needs it
 * (`delivery-returns/_components/dc-return-form.tsx`) and the service is
 * `import "server-only"`: a value import from there drags the server module into
 * the browser bundle and fails the production build (Vercel, 2026-11-03). The
 * service re-exports it, so server callers are unchanged.
 */
export const partyOf = (dc: { vendor_name: string | null; party_name: string | null }) => dc.vendor_name ?? dc.party_name ?? "—";
