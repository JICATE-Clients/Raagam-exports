/**
 * NO PLACEHOLDER TEXT ANYWHERE (user 2026-10-15: "no more placeholder message
 * anywhere, hide it globally — if needed I will enable it").
 *
 * One switch for the whole app. Every primitive that can show a placeholder —
 * `Input`, `Textarea`, `Select`, `Combobox`, `DataPicker`, `MultiSelect` —
 * passes its hint through `hint()`, so flipping `SHOW_PLACEHOLDERS` to `true`
 * brings every one of them back at once, and no screen changed to lose them.
 *
 * WHY NOT A CSS `::placeholder { color: transparent }`: the pickers DRAW THEIR
 * SELECTED VALUE through the `placeholder` attribute (`DataPicker` and
 * `Combobox`: `placeholder={selected ? selected.label : …}`), so a stylesheet
 * rule would have blanked every chosen value in every dropdown. Only the
 * EMPTY-field hint goes through `hint()`; a selected value never does.
 */
export const SHOW_PLACEHOLDERS = false;

/** The placeholder to draw: the text itself while the switch is on, else nothing. */
export function hint(text: string | undefined): string | undefined {
  return SHOW_PLACEHOLDERS ? text : undefined;
}
