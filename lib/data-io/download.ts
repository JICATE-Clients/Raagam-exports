/**
 * Trigger a browser download for an in-memory Blob. Extracted from the
 * duplicated snippet in `lib/reports/export-excel.ts` and the Tally
 * `download-button.tsx` so every exporter shares one implementation.
 * Browser-only.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
