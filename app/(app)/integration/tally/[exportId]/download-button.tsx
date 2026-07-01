"use client";

import { Button } from "@/components/ui/button";

interface DownloadButtonProps {
  xmlContent: string;
  filename: string;
}

export function DownloadButton({ xmlContent, filename }: DownloadButtonProps) {
  function handleDownload() {
    const blob = new Blob([xmlContent], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" onClick={handleDownload}>
      Download XML
    </Button>
  );
}
