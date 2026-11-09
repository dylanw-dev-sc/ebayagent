"use client";

import { updateOnlineLookupSettingsAction } from "@/app/actions/pricing";
import { ActionForm, SubmitButton } from "../forms";

export function OnlineLookupSettingsForm({
  settings,
  maxCap,
}: {
  settings: { onlineLookups: boolean; monthlyLookupCap: number; lookupsPerScan: number; blockedDomains: string[] };
  maxCap: number;
}) {
  return (
    <ActionForm action={updateOnlineLookupSettingsAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-4">
        <input type="checkbox" name="onlineLookups" defaultChecked={settings.onlineLookups} className="size-4 accent-ink" />
        Look up new prices online during scans
      </label>
      <label>
        <span className="label">Monthly cap (max {maxCap.toLocaleString()})</span>
        <input name="monthlyLookupCap" inputMode="numeric" defaultValue={settings.monthlyLookupCap} className="field tabular" />
      </label>
      <label>
        <span className="label">Kinds of item per scan</span>
        <input name="lookupsPerScan" inputMode="numeric" defaultValue={settings.lookupsPerScan} className="field tabular" />
      </label>
      <label className="sm:col-span-4">
        <span className="label">Stores whose prices don&apos;t count as new retail (resale, marketplaces, aggregators)</span>
        <textarea name="blockedDomains" rows={2} defaultValue={settings.blockedDomains.join(", ")} className="field" />
      </label>
      <div className="sm:col-span-4">
        <SubmitButton variant="secondary">Save online price settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
