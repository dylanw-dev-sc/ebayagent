"use client";

import { createBrandAction, updateBrandAction } from "@/app/actions/preferences";
import { ActionForm, SubmitButton } from "../forms";

export interface BrandFormValues {
  id?: number;
  name?: string;
  searchQuery?: string;
  aliases?: string[];
  excludePhrases?: string[];
  groupIds?: number[];
  notes?: string | null;
}

export function BrandForm({ groups, initial }: { groups: Array<{ id: number; name: string }>; initial?: BrandFormValues }) {
  const editing = !!initial?.id;
  return (
    <ActionForm action={editing ? updateBrandAction : createBrandAction} resetOnSuccess={!editing} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {editing ? <input type="hidden" name="id" value={initial!.id} /> : null}
      <label>
        <span className="label">Brand name</span>
        <input name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Caruso" className="field" />
      </label>
      <label>
        <span className="label">eBay search keywords</span>
        <input name="searchQuery" defaultValue={initial?.searchQuery ?? ""} placeholder="Defaults to the name" className="field" />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Aliases (comma-separated)</span>
        <input name="aliases" defaultValue={(initial?.aliases ?? []).join(", ")} placeholder="Alternative spellings, e.g. APC, A.P.C" className="field" />
        <span className="hint">Matched as whole phrases, ignoring case, accents and punctuation.</span>
      </label>
      <label className="sm:col-span-2">
        <span className="label">Never match when the listing contains</span>
        <input name="excludePhrases" defaultValue={(initial?.excludePhrases ?? []).join(", ")} placeholder="e.g. diffusion lines or unrelated namesakes" className="field" />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="label">Groups</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" name="groupIds" value={g.id} defaultChecked={initial?.groupIds?.includes(g.id)} className="size-4 accent-ink" />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="sm:col-span-2">
        <span className="label">Notes</span>
        <input name="notes" defaultValue={initial?.notes ?? ""} className="field" />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton>{editing ? "Save brand" : "Add brand"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
