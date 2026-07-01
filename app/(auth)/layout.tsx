import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            R
          </div>
          <h1 className="text-xl font-semibold text-foreground">Raagam ERP</h1>
          <p className="text-xs text-muted-foreground">Raagam Exports</p>
        </div>
        {children}
      </div>
    </div>
  );
}
