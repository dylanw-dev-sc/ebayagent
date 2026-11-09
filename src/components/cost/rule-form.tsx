"use client";

import { useState } from "react";
import { createRuleAction, updateRuleAction } from "@/app/actions/pricing";
import { computeCeilingMinor, formatMoney, parseMoneyToMinor, parsePercentToBps } from "@/lib/money";
import { ActionForm, SubmitButton } from "../forms";

interface Option {
  id: number;
  name: string;
}

export interface RuleDefaults {
  id?: number;
  categoryId?: number;
  brandId?: number | null;
  retail?: string;
  percent?: string;
  retailSource?: string | null;
  notes?: string | null;
  active?: boolean;
}

/** Add / edit a pricing rule with a live "maximum secondhand price" preview. */
export function RuleForm({ categories, brands, initial, mode }: { categories: Option[]; brands: Option[]; initial?: RuleDefaults; mode: "create" | "edit" }) {
  const [retail, setRetail] = useState(initial?.retail ?? "");
  const [percent, setPercent] = useState(initial?.percent ?? "");
  const retailMinor = parseMoneyToMinor(retail);
  const bps = parsePercentToBps(percent);
  const preview = retailMinor !== null && bps !== null && bps > 0 && bps <= 10000 ? computeCeilingMinor(retailMinor, bps) : null;

  return (
    <ActionForm action={mode === "create" ? createRuleAction : updateRuleAction} resetOnSuccess={mode === "create"} className="grid grid-cols-2 gap-3 md:grid-cols-12">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <label className="col-span-2 md:col-span-2">
        <span className="label">Category</span>
        <select name="categoryId" required defaultValue={initial?.categoryId ?? ""} className="field">
          <option value="" disabled>
            Choose…
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="col-span-2 md:col-span-3">
        <span className="label">Brand</span>
        <select name="brandId" defaultValue={initial?.brandId ?? ""} className="field">
          <option value="">All brands (category-wide)</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-2">
        <span className="label">Reference retail (USD)</span>
        <input name="retail" inputMode="decimal" required value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="e.g. 495" className="field tabular" />
      </label>
      <label className="md:col-span-2">
        <span className="label">Allowed % of retail</span>
        <input name="percent" inputMode="decimal" required value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 40" className="field tabular" />
      </label>
      <label className="col-span-2 md:col-span-3">
        <span className="label">Retail-price source</span>
        <input name="retailSource" defaultValue={initial?.retailSource ?? ""} placeholder="e.g. brand site, Oct 2026" className="field" />
      </label>
      <label className="col-span-2 md:col-span-7">
        <span className="label">Notes</span>
        <input name="notes" defaultValue={initial?.notes ?? ""} placeholder="Optional" className="field" />
      </label>
      <div className="col-span-2 flex flex-wrap items-end justify-between gap-3 md:col-span-5">
        {mode === "edit" ? (
          <label className="flex h-9 items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} className="size-4 accent-ink" /> Active
          </label>
        ) : null}
        <div className="text-right">
          <p className="eyebrow">Max secondhand price</p>
          <p className="text-lg font-semibold text-ink tabular">{preview !== null ? formatMoney(preview) : "—"}</p>
        </div>
        <SubmitButton>{mode === "create" ? "Add rule" : "Save rule"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
