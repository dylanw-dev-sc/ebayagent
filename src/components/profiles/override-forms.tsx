"use client";

import { setOverrideAction, setSizeOverrideAction, updateProfileMetaAction, createProfileAction } from "@/app/actions/profiles";
import type { SizePrefs } from "@/lib/domain/types";
import { ActionForm, SubmitButton } from "../forms";

interface Opt {
  value: string | number;
  label: string;
  hint?: string;
}

/** Checkbox list override (brands/categories/conditions/materials). */
export function CheckboxOverrideForm({
  profileId,
  field,
  name,
  options,
  selected,
  columns = 3,
  submitLabel = "Save override",
}: {
  profileId: number;
  field: string;
  name: string;
  options: Opt[];
  selected: Array<string | number>;
  columns?: 2 | 3 | 4;
  submitLabel?: string;
}) {
  const sel = new Set(selected.map(String));
  return (
    <ActionForm action={setOverrideAction} className="space-y-3">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="field" value={field} />
      <div className={columns === 2 ? "grid gap-x-6 gap-y-1.5 sm:grid-cols-2" : columns === 4 ? "grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3"}>
        {options.map((o) => (
          <label key={String(o.value)} className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" name={name} value={o.value} defaultChecked={sel.has(String(o.value))} className="mt-0.5 size-4 shrink-0 accent-ink" />
            <span>
              {o.label}
              {o.hint ? <span className="block text-xs text-ink-3">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <SubmitButton variant="secondary">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function BrandScopeForm({
  profileId,
  groups,
  brands,
  selectedGroups,
  selectedBrands,
}: {
  profileId: number;
  groups: Opt[];
  brands: Opt[];
  selectedGroups: number[];
  selectedBrands: number[];
}) {
  const g = new Set(selectedGroups);
  const b = new Set(selectedBrands);
  return (
    <ActionForm action={setOverrideAction} className="space-y-4">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="field" value="brandScope" />
      <fieldset>
        <legend className="label">Include every enabled brand in these groups</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {groups.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" name="groupIds" value={o.value} defaultChecked={g.has(Number(o.value))} className="size-4 accent-ink" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">…plus these individual brands</legend>
        <div className="grid max-h-64 gap-x-6 gap-y-1.5 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" name="brandIds" value={o.value} defaultChecked={b.has(Number(o.value))} className="size-4 accent-ink" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton variant="secondary">Save brand override</SubmitButton>
    </ActionForm>
  );
}

export function PolicyForm({ profileId, value }: { profileId: number; value: string }) {
  return (
    <ActionForm action={setOverrideAction} className="space-y-3">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="field" value="unknownMaterialPolicy" />
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="radio" name="unknownMaterialPolicy" value="review" defaultChecked={value === "review"} className="accent-ink" />
          Send to Needs review
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="radio" name="unknownMaterialPolicy" value="allow" defaultChecked={value === "allow"} className="accent-ink" />
          Allow as a match
        </label>
      </div>
      <SubmitButton variant="secondary">Save override</SubmitButton>
    </ActionForm>
  );
}

export function TextOverrideForm({ profileId, field, name, value, placeholder, label }: { profileId: number; field: string; name: string; value: string; placeholder?: string; label: string }) {
  return (
    <ActionForm action={setOverrideAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="field" value={field} />
      <label className="min-w-64 flex-1">
        <span className="label">{label}</span>
        <input name={name} defaultValue={value} placeholder={placeholder} className="field" />
      </label>
      <SubmitButton variant="secondary">Save override</SubmitButton>
    </ActionForm>
  );
}

export function SizeOverrideForm({ profileId, categoryId, prefs, showNeck }: { profileId: number; categoryId: number; prefs: SizePrefs; showNeck: boolean }) {
  return (
    <ActionForm action={setSizeOverrideAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <label>
        <span className="label">Accepted sizes</span>
        <input name="accepted" defaultValue={prefs.accepted.join(", ")} className="field" />
      </label>
      <label>
        <span className="label">Sizes to review</span>
        <input name="review" defaultValue={prefs.review.join(", ")} className="field" />
      </label>
      {showNeck ? (
        <>
          <label>
            <span className="label">Neck sizes</span>
            <input name="neck" defaultValue={prefs.neck.join(", ")} className="field" placeholder="e.g. 16.5" />
          </label>
          <label>
            <span className="label">Sleeve lengths</span>
            <input name="sleeve" defaultValue={prefs.sleeve.join(", ")} className="field" placeholder="e.g. 34, 35" />
          </label>
        </>
      ) : null}
      <div className="sm:col-span-2 lg:col-span-4">
        <SubmitButton variant="secondary">Save size override</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ProfileMetaForm({ profileId, name, description }: { profileId: number; name: string; description: string | null }) {
  return (
    <ActionForm action={updateProfileMetaAction} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
      <input type="hidden" name="profileId" value={profileId} />
      <label>
        <span className="label">Profile name</span>
        <input name="name" required defaultValue={name} className="field" />
      </label>
      <label>
        <span className="label">Description</span>
        <input name="description" defaultValue={description ?? ""} className="field" />
      </label>
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}

export function CreateProfileForm() {
  return (
    <ActionForm action={createProfileAction} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
      <label>
        <span className="label">New profile name</span>
        <input name="name" required placeholder="e.g. Cashmere Knits" className="field" />
      </label>
      <label>
        <span className="label">Description</span>
        <input name="description" placeholder="Optional" className="field" />
      </label>
      <SubmitButton>Create profile</SubmitButton>
    </ActionForm>
  );
}
