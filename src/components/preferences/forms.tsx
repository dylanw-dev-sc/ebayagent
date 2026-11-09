"use client";

import {
  createCategoryAction,
  createConditionAction,
  createGroupAction,
  createMaterialAction,
  updateCategoryAction,
  updateDefaultsAction,
  updateGroupAction,
  updateMaterialAction,
  updateScanSettingsAction,
} from "@/app/actions/preferences";
import type { SizeSystem } from "@/lib/domain/types";
import { MEASUREMENT_KEYS, MEASUREMENT_LABEL, type MeasurementRanges } from "@/lib/matching/measurements";
import { ActionForm, SubmitButton } from "../forms";

export interface CategoryValues {
  measurementRanges?: MeasurementRanges;
  id?: number;
  name?: string;
  noun?: string;
  description?: string | null;
  sizeSystem?: SizeSystem;
  acceptedSizes?: string[];
  reviewSizes?: string[];
  neckSizes?: string[];
  sleeveLengths?: string[];
  ebayCategoryIds?: string[];
  titleKeywords?: string[];
  excludeKeywords?: string[];
}

const join = (v?: string[]) => (v ?? []).join(", ");

export function CategoryForm({ initial }: { initial?: CategoryValues }) {
  const editing = !!initial?.id;
  return (
    <ActionForm action={editing ? updateCategoryAction : createCategoryAction} resetOnSuccess={!editing} className="grid grid-cols-1 gap-3 md:grid-cols-6">
      {editing ? <input type="hidden" name="id" value={initial!.id} /> : null}
      <label className="md:col-span-2">
        <span className="label">Name</span>
        <input name="name" required defaultValue={initial?.name ?? ""} className="field" placeholder="e.g. Sweaters" />
      </label>
      <label className="md:col-span-2">
        <span className="label">Singular noun (for explanations)</span>
        <input name="noun" defaultValue={initial?.noun ?? ""} className="field" placeholder="e.g. sweater" />
      </label>
      <label className="md:col-span-2">
        <span className="label">Size system</span>
        <select name="sizeSystem" defaultValue={initial?.sizeSystem ?? "alpha"} className="field">
          <option value="alpha">Letter sizes (S, M, L, XL)</option>
          <option value="alpha_neck_sleeve">Letter + neck/sleeve (shirts)</option>
          <option value="tailored">Tailored (44R, 42L)</option>
        </select>
      </label>
      <label className="md:col-span-3">
        <span className="label">Accepted sizes</span>
        <input name="acceptedSizes" defaultValue={join(initial?.acceptedSizes)} className="field" placeholder="e.g. L, XL  or  44R" />
        <span className="hint">Exact or unambiguous equivalents only (44R = “44 Regular”).</span>
      </label>
      <label className="md:col-span-3">
        <span className="label">Sizes to review (possible fit)</span>
        <input name="reviewSizes" defaultValue={join(initial?.reviewSizes)} className="field" placeholder="e.g. XL" />
        <span className="hint">These go to Needs Review instead of being excluded.</span>
      </label>
      <label className="md:col-span-3">
        <span className="label">Accepted neck sizes (in)</span>
        <input name="neckSizes" defaultValue={join(initial?.neckSizes)} className="field" placeholder="e.g. 16.5 (leave empty if unknown)" />
      </label>
      <label className="md:col-span-3">
        <span className="label">Accepted sleeve lengths (in)</span>
        <input name="sleeveLengths" defaultValue={join(initial?.sleeveLengths)} className="field" placeholder="e.g. 34, 35" />
      </label>
      <label className="md:col-span-2">
        <span className="label">eBay category IDs</span>
        <input name="ebayCategoryIds" defaultValue={join(initial?.ebayCategoryIds)} className="field tabular" placeholder="e.g. 11484" />
        <span className="hint">One search per brand × eBay category.</span>
      </label>
      <label className="md:col-span-2">
        <span className="label">Title keywords (fallback)</span>
        <input name="titleKeywords" defaultValue={join(initial?.titleKeywords)} className="field" placeholder="e.g. sweater, jumper" />
      </label>
      <label className="md:col-span-2">
        <span className="label">Exclude titles containing</span>
        <input name="excludeKeywords" defaultValue={join(initial?.excludeKeywords)} className="field" placeholder="e.g. trousers" />
      </label>
      <fieldset className="md:col-span-6">
        <legend className="label">Your measurements — flat, in inches (optional)</legend>
        <p className="hint mb-2">
          When a listing gives measurements (e.g. “pit to pit 23 in”), they settle unclear sizes: inside your ranges → match, outside → excluded. A listing whose size label
          and measurements disagree goes to review. Leave blank to ignore.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {MEASUREMENT_KEYS.map((key) => (
            <div key={key}>
              <span className="label capitalize">{MEASUREMENT_LABEL[key]}</span>
              <div className="flex items-center gap-1.5">
                <input name={`m_${key}_min`} inputMode="decimal" defaultValue={initial?.measurementRanges?.[key]?.min ?? ""} placeholder="min" aria-label={`${MEASUREMENT_LABEL[key]} minimum`} className="field tabular" />
                <span className="text-ink-3">–</span>
                <input name={`m_${key}_max`} inputMode="decimal" defaultValue={initial?.measurementRanges?.[key]?.max ?? ""} placeholder="max" aria-label={`${MEASUREMENT_LABEL[key]} maximum`} className="field tabular" />
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <label className="md:col-span-6">
        <span className="label">Description</span>
        <input name="description" defaultValue={initial?.description ?? ""} className="field" />
      </label>
      <div className="md:col-span-6">
        <SubmitButton>{editing ? "Save category" : "Add category"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function GroupForm({ initial }: { initial?: { id: number; name: string; description: string | null } }) {
  return (
    <ActionForm action={initial ? updateGroupAction : createGroupAction} resetOnSuccess={!initial} className="flex flex-wrap items-end gap-2">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <label className="min-w-48 flex-1">
        <span className="label">{initial ? "Group name" : "New group name"}</span>
        <input name="name" required defaultValue={initial?.name ?? ""} className="field" />
      </label>
      <label className="min-w-48 flex-1">
        <span className="label">Description</span>
        <input name="description" defaultValue={initial?.description ?? ""} className="field" />
      </label>
      <SubmitButton variant="secondary">{initial ? "Save" : "Add group"}</SubmitButton>
    </ActionForm>
  );
}

export function MaterialEditForm({ m }: { m: { id: number; name: string; kind: "fiber" | "blend"; keywords: string[]; components: string[]; heavyThresholdPct: number | null } }) {
  return (
    <ActionForm action={updateMaterialAction} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={m.id} />
      <label>
        <span className="label">Name</span>
        <input name="name" defaultValue={m.name} className="field" />
      </label>
      {m.kind === "fiber" ? (
        <label className="sm:col-span-2">
          <span className="label">Detection words (comma-separated)</span>
          <input name="keywords" defaultValue={m.keywords.join(", ")} className="field" />
        </label>
      ) : (
        <label className="sm:col-span-2">
          <span className="label">Component material keys</span>
          <input name="components" defaultValue={m.components.join(", ")} className="field" />
        </label>
      )}
      <label>
        <span className="label">Applies at ≥ % (avoid/exclude)</span>
        <input name="heavyThresholdPct" inputMode="numeric" defaultValue={m.heavyThresholdPct ?? ""} placeholder="any amount" className="field tabular" />
      </label>
      <div className="flex items-end sm:col-span-2">
        <SubmitButton variant="secondary">Save material</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MaterialCreateForm() {
  return (
    <ActionForm action={createMaterialAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      <label className="sm:col-span-2">
        <span className="label">Name</span>
        <input name="name" required className="field" placeholder="e.g. Mohair" />
      </label>
      <label>
        <span className="label">Type</span>
        <select name="kind" className="field" defaultValue="fiber">
          <option value="fiber">Fiber</option>
          <option value="blend">Blend</option>
        </select>
      </label>
      <label>
        <span className="label">Priority</span>
        <select name="priority" className="field" defaultValue="neutral">
          <option value="very_high">Very high</option>
          <option value="high">High</option>
          <option value="neutral">Neutral</option>
          <option value="avoid">Generally avoid</option>
          <option value="exclude">Exclude</option>
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className="label">Detection words / blend components</span>
        <input name="keywords" className="field" placeholder="fiber: words · blend: use the field below" />
      </label>
      <label className="sm:col-span-3">
        <span className="label">Blend components (material keys)</span>
        <input name="components" className="field" placeholder="e.g. silk, linen" />
      </label>
      <label>
        <span className="label">Applies at ≥ %</span>
        <input name="heavyThresholdPct" inputMode="numeric" className="field" placeholder="any" />
      </label>
      <div className="flex items-end sm:col-span-2">
        <SubmitButton variant="secondary">Add material</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ConditionCreateForm() {
  return (
    <ActionForm action={createConditionAction} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1">
        <span className="label">Condition name</span>
        <input name="name" required className="field" />
      </label>
      <label className="min-w-32">
        <span className="label">eBay condition IDs</span>
        <input name="ebayConditionIds" className="field tabular" placeholder="e.g. 2750" />
      </label>
      <label className="min-w-40 flex-1">
        <span className="label">Match terms</span>
        <input name="matchTerms" className="field" placeholder="text eBay uses" />
      </label>
      <SubmitButton variant="secondary">Add condition</SubmitButton>
    </ActionForm>
  );
}

export function DefaultsForm({
  d,
}: {
  d: { unknownMaterialPolicy: string; excludeKeywords: string[]; priceMin: string; priceMax: string; redFlagPhrases: string[]; redFlagPolicy: string };
}) {
  return (
    <ActionForm action={updateDefaultsAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <fieldset>
        <legend className="label">When a listing doesn&apos;t state its fabric</legend>
        <label className="flex items-start gap-2 py-1 text-sm text-ink-2">
          <input type="radio" name="unknownMaterialPolicy" value="review" defaultChecked={d.unknownMaterialPolicy === "review"} className="mt-1 accent-ink" />
          <span>
            Send to <strong className="font-semibold text-ink">Needs review</strong> <span className="text-ink-3">(recommended — unknown is never treated as a match)</span>
          </span>
        </label>
        <label className="flex items-start gap-2 py-1 text-sm text-ink-2">
          <input type="radio" name="unknownMaterialPolicy" value="allow" defaultChecked={d.unknownMaterialPolicy === "allow"} className="mt-1 accent-ink" />
          <span>Allow as a match if everything else matches</span>
        </label>
      </fieldset>
      <label>
        <span className="label">Exclude titles containing (all profiles by default)</span>
        <input name="excludeKeywords" defaultValue={d.excludeKeywords.join(", ")} className="field" placeholder="e.g. kids, womens, replica" />
      </label>
      <label>
        <span className="label">Minimum item price (USD)</span>
        <input name="priceMin" inputMode="decimal" defaultValue={d.priceMin} className="field tabular" placeholder="No minimum" />
      </label>
      <label>
        <span className="label">Maximum item price (USD)</span>
        <input name="priceMax" inputMode="decimal" defaultValue={d.priceMax} className="field tabular" placeholder="No maximum" />
        <span className="hint">A simple search filter. Ceilings based on retail live in the Cost Evaluator.</span>
      </label>
      <label className="md:col-span-2">
        <span className="label">Counterfeit red flags (title or description)</span>
        <textarea name="redFlagPhrases" rows={2} defaultValue={d.redFlagPhrases.join(", ")} className="field" />
        <span className="hint">Comma-separated. Negated mentions such as “not a replica” or “no fakes” are ignored.</span>
      </label>
      <fieldset className="md:col-span-2">
        <legend className="label">When a red flag appears</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
          {[
            ["exclude", "Exclude the listing (recommended)"],
            ["review", "Send to Needs review"],
            ["flag", "Just show a warning"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" name="redFlagPolicy" value={value} defaultChecked={d.redFlagPolicy === value} className="accent-ink" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="md:col-span-2">
        <SubmitButton>Save defaults</SubmitButton>
      </div>
    </ActionForm>
  );
}

export interface ScanSettingsValues {
  minSellerFeedbackScore: number | null;
  minSellerFeedbackPercent: number | null;
  maxListingAgeDays: number;
  pageSize: number;
  maxPagesPerQuery: number;
  lookbackHours: number;
  detailFetchLimit: number;
  dailyCallBudget: number;
  requestIntervalMs: number;
  includeAuctions: boolean;
  deliveryCountry: string;
  retentionDays: number;
  staleAfterHours: number;
}

export function ScanSettingsForm({ s }: { s: ScanSettingsValues }) {
  const num = (name: Exclude<keyof ScanSettingsValues, "includeAuctions" | "deliveryCountry" | "minSellerFeedbackScore" | "minSellerFeedbackPercent">, label: string, hint: string) => (
    <label>
      <span className="label">{label}</span>
      <input name={name} inputMode="numeric" defaultValue={String(s[name])} className="field tabular" />
      <span className="hint">{hint}</span>
    </label>
  );
  return (
    <ActionForm action={updateScanSettingsAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {num("maxListingAgeDays", "Only listings posted in the last (days)", "1–30. Older listings are skipped and removed; saved items are kept")}
      {num("pageSize", "Results per page", "1–200 (eBay maximum 200)")}
      {num("maxPagesPerQuery", "Pages per search", "Each page is one API call")}
      {num("lookbackHours", "Look-back window (hours)", "eBay can index new listings late")}
      {num("detailFetchLimit", "Item-detail calls per scan", "Fetches size/fabric/brand specifics")}
      {num("dailyCallBudget", "Daily call budget", "eBay's default Browse limit is 5,000/day")}
      {num("requestIntervalMs", "Delay between calls (ms)", "Gentle pacing for eBay's API")}
      {num("retentionDays", "Keep unconfirmed listings (days)", "1–30; then deleted per eBay data rules")}
      {num("staleAfterHours", "Label data stale after (hours)", "eBay: disclose data older than 6 h")}
      <label>
        <span className="label">Deliver-to country</span>
        <input name="deliveryCountry" defaultValue={s.deliveryCountry} className="field uppercase" maxLength={2} />
        <span className="hint">Only listings that ship here (blank = any)</span>
      </label>
      <label>
        <span className="label">Minimum seller feedback score</span>
        <input name="minSellerFeedbackScore" inputMode="numeric" defaultValue={s.minSellerFeedbackScore ?? ""} placeholder="off" className="field tabular" />
        <span className="hint">Applied while scanning; seller details are never stored</span>
      </label>
      <label>
        <span className="label">Minimum positive feedback (%)</span>
        <input name="minSellerFeedbackPercent" inputMode="decimal" defaultValue={s.minSellerFeedbackPercent ?? ""} placeholder="off" className="field tabular" />
        <span className="hint">e.g. 98. Listings without seller info aren&apos;t affected</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2 lg:col-span-3">
        <input type="checkbox" name="includeAuctions" defaultChecked={s.includeAuctions} className="size-4 accent-ink" />
        Include auctions (eBay returns Buy It Now listings only unless this is on; auction prices are current bids)
      </label>
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton>Save scan settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
