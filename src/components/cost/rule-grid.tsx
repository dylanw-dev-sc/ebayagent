"use client";

import { importRulesCsvAction, saveRuleGridAction } from "@/app/actions/pricing";
import { ActionForm, SubmitButton } from "../forms";

export interface GridValue {
  retail: string;
  percent: string;
  active: boolean;
}

/** Enter many rules at once: one row per brand, one column per category. */
export function RuleGrid({
  categories,
  brands,
  cells,
  defaultPercent,
}: {
  categories: Array<{ id: number; name: string }>;
  brands: Array<{ id: number; name: string }>;
  cells: Record<string, GridValue>;
  /** Your default allowed % (used by blank % cells and by online prices). */
  defaultPercent: string;
}) {
  const rows: Array<{ id: number | null; name: string }> = [{ id: null, name: "All brands (category-wide)" }, ...brands];
  return (
    <ActionForm action={saveRuleGridAction} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-44">
          <span className="label">Your default %</span>
          <input name="defaultPercent" inputMode="decimal" defaultValue={defaultPercent} placeholder="e.g. 33" className="field tabular" />
        </label>
        <label className="min-w-56 flex-1">
          <span className="label">Retail-price source (for rules you change)</span>
          <input name="retailSource" placeholder="e.g. brand websites, Nov 2026" className="field" />
        </label>
        <SubmitButton>Save grid</SubmitButton>
      </div>
      <p className="hint">
        Each cell is a reference retail (new) price in USD and an allowed % of retail. A blank % uses your default %, which also applies to online prices. Clearing a retail
        price removes that rule. Prices for one material only (e.g. cashmere sweaters) are added with the rule form or by CSV.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs text-ink-3">
            <tr>
              <th className="sticky left-0 z-10 bg-canvas px-4 py-2.5 font-semibold">Brand</th>
              {categories.map((c) => (
                <th key={c.id} className="px-3 py-2.5 font-semibold">
                  {c.name}
                  <span className="block font-normal">retail $ · allowed %</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((b) => (
              <tr key={b.id ?? "all"} className={b.id === null ? "bg-canvas/50" : undefined}>
                <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-[13px] font-medium whitespace-nowrap text-ink">{b.name}</th>
                {categories.map((c) => {
                  const k = `${c.id}_${b.id ?? "all"}`;
                  const v = cells[k];
                  return (
                    <td key={k} className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <input name={`r_${k}`} defaultValue={v?.retail ?? ""} inputMode="decimal" placeholder="$" aria-label={`${b.name} ${c.name} retail`} className="field h-8 w-24 px-2 py-0 text-[13px] tabular" />
                        <input name={`p_${k}`} defaultValue={v?.percent ?? ""} inputMode="decimal" placeholder="%" aria-label={`${b.name} ${c.name} allowed percent`} className="field h-8 w-16 px-2 py-0 text-[13px] tabular" />
                        {v && !v.active ? <span className="text-[11px] text-ink-3">inactive</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubmitButton>Save grid</SubmitButton>
    </ActionForm>
  );
}

export function CsvImportForm() {
  return (
    <ActionForm action={importRulesCsvAction} className="flex flex-wrap items-end gap-3">
      <label className="min-w-64 flex-1">
        <span className="label">Import rules from CSV</span>
        <input name="file" type="file" accept=".csv,text/csv" className="field py-1.5 text-[13px]" />
        <span className="hint">Columns: category, brand, reference_retail_usd, allowed_percent, retail_source, notes, active. Rows without a retail price are ignored.</span>
      </label>
      <SubmitButton variant="secondary">Import</SubmitButton>
    </ActionForm>
  );
}
