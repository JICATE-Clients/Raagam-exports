import { ShieldOff } from "lucide-react";

/** The database refused this caller (42501) — said as a permission, not a fault. */
export function WorkspaceForbidden({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-2 p-6" role="alert">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-heading">
        <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden /> {title}
      </h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
