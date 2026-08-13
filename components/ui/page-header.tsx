import { type ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      /**
       * THE PAGE HEADER IS CHROME, NOT FIELDS.
       *
       * `regionOf` resolves through `closest("[data-focus-region]")`, so this one
       * attribute covers every `actions` button on every screen — "← Back to
       * list", "New Amendment", a Download — wherever a PageHeader sits inside a
       * `data-focus-scope`.
       *
       * Without it those buttons default to `"content"` and sort WITH the fields,
       * so Tab off the last field of a page editor lands on "← Back to list"
       * rather than wrapping. That is the same rule the keyboard contract states
       * for a Sheet's ✕ ("an unmarked ✕ sorts with the fields: stamp the
       * header"), applied where ~51 page-level editors need it.
       *
       * Inert outside an editor: a list page declares no focus scope, so nothing
       * reads this and native Tab order is unchanged.
       */
      data-focus-region="header"
      className="mb-4 flex flex-wrap items-start justify-between gap-3"
    >
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
