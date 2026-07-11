import { Hammer } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Placeholder shown on a route whose structure exists in the nav but whose
 * screen isn't built yet. `legacy` names the source legacy task; `points` lists
 * what the finished screen will do. Keeps scaffolded siblings visually uniform.
 */
export function ScaffoldNotice({
  legacy,
  points,
}: {
  legacy: string;
  points: string[];
}) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Hammer className="h-4 w-4 text-muted-foreground" />
          {legacy}
        </div>
        <p className="text-sm text-muted-foreground">
          This screen is scaffolded — the route and navigation are in place, but
          the screen itself isn&apos;t built yet. When implemented it will:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
