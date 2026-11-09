import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { resetOverrideAction, toggleProfileAction } from "@/app/actions/profiles";
import { ActionButton, Toggle } from "@/components/forms";
import { BrandScopeForm, CheckboxOverrideForm, PolicyForm, ProfileMetaForm, SizeOverrideForm, TextOverrideForm } from "@/components/profiles/override-forms";
import { Badge, PageSkeleton } from "@/components/ui";
import type { ProfileOverrides } from "@/lib/profiles/resolve";
import { formatMoney } from "@/lib/money";
import { loadBrands, loadCategories, loadConditions, loadGroups, loadMaterials, loadPersonalDefaults } from "@/server/services/context";
import { getProfile } from "@/server/services/profiles";
import { requestDb } from "@/server/request";

export const metadata: Metadata = { title: "Edit Search Profile" };

export default function ProfileEditPage({ params }: PageProps<"/profiles/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Editor params={params} />
    </Suspense>
  );
}

function Setting({
  title,
  description,
  overridden,
  current,
  resetAction,
  children,
}: {
  title: string;
  description?: string;
  overridden: boolean;
  current: ReactNode;
  resetAction?: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {overridden ? <Badge tone="ink">Overridden in this profile</Badge> : <Badge>Inherited from Preferences</Badge>}
          </div>
          {description ? <p className="mt-1 text-[13px] text-ink-3">{description}</p> : null}
        </div>
        {overridden && resetAction ? (
          <ActionButton action={resetAction} variant="small">
            Reset to default
          </ActionButton>
        ) : null}
      </div>
      <div className="mt-3 text-sm text-ink-2">{current}</div>
      <details className="mt-4 rounded-lg border border-line bg-canvas/60 p-4" open={false}>
        <summary className="cursor-pointer text-[13px] font-semibold text-ink">{overridden ? "Change override" : "Override for this profile"}</summary>
        <div className="mt-4">{children}</div>
      </details>
    </section>
  );
}

async function Editor({ params }: { params: PageProps<"/profiles/[id]">["params"] }) {
  const { id: idParam } = await params;
  const db = await requestDb();
  const id = Number(idParam);
  const profile = Number.isInteger(id) ? getProfile(db, id) : null;
  if (!profile) notFound();
  const brands = loadBrands(db);
  const groups = loadGroups(db);
  const categories = loadCategories(db);
  const conditions = loadConditions(db);
  const materials = loadMaterials(db);
  const defaults = loadPersonalDefaults(db);
  const st = profile.resolved.settings;
  const pv = profile.resolved.provenance;
  const reset = (field: keyof ProfileOverrides, categoryId?: number) => resetOverrideAction.bind(null, profile.id, field, categoryId);
  const names = (ids: number[], list: Array<{ id: number; name: string }>) => ids.map((x) => list.find((l) => l.id === x)?.name).filter(Boolean).join(", ");
  const matNames = (keys: string[]) => keys.map((k) => materials.find((m) => m.key === k)?.name ?? k).join(", ");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/profiles" className="text-[13px] font-medium text-ink-3 hover:text-ink">
            ← Search Profiles
          </Link>
          <h1 className="mt-2 font-display text-[2.5rem] leading-[1.05] font-semibold text-ink">{profile.name}</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-2">Settings marked “Inherited” follow your Preferences automatically. Overrides apply to this profile only and are never overwritten when defaults change.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-2">{profile.enabled ? "Enabled" : "Disabled"}</span>
          <Toggle checked={profile.enabled} onChange={toggleProfileAction.bind(null, profile.id)} label="Profile enabled" />
        </div>
      </header>

      <div className="card p-5">
        <ProfileMetaForm profileId={profile.id} name={profile.name} description={profile.description} />
      </div>

      <Setting
        title="Brands"
        description="Scope by brand group and/or individual brands. Disabled brands are always excluded."
        overridden={pv.brandScope === "override"}
        resetAction={reset("brandScope")}
        current={
          <>
            <strong className="font-semibold text-ink">{st.brandIds.length} brands:</strong> {names(st.brandIds, brands) || "none"}
          </>
        }
      >
        <BrandScopeForm
          profileId={profile.id}
          groups={groups.map((g) => ({ value: g.id, label: g.name }))}
          brands={brands.filter((b) => b.enabled).map((b) => ({ value: b.id, label: b.name }))}
          selectedGroups={profile.overrides.brandScope?.groupIds ?? []}
          selectedBrands={profile.overrides.brandScope?.brandIds ?? []}
        />
      </Setting>

      <Setting title="Categories" overridden={pv.categoryIds === "override"} resetAction={reset("categoryIds")} current={names(st.categoryIds, categories) || "None"}>
        <CheckboxOverrideForm
          profileId={profile.id}
          field="categoryIds"
          name="categoryIds"
          options={categories.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }))}
          selected={st.categoryIds}
        />
      </Setting>

      <section className="card p-5">
        <h2 className="text-base font-semibold text-ink">Sizes by category</h2>
        <p className="mt-1 text-[13px] text-ink-3">Each category inherits its sizes from Preferences unless overridden here.</p>
        <div className="mt-4 divide-y divide-line">
          {categories
            .filter((c) => st.categoryIds.includes(c.id))
            .map((c) => {
              const overridden = profile.resolved.sizeProvenance[c.id] === "override";
              const prefs = st.sizes[c.id];
              return (
                <div key={c.id} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink">{c.name}</p>
                      {overridden ? <Badge tone="ink">Override</Badge> : <Badge>Inherited</Badge>}
                    </div>
                    {overridden ? (
                      <ActionButton action={reset("sizes", c.id)} variant="small">
                        Reset to default
                      </ActionButton>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-2">
                    Accepted: {prefs.accepted.join(", ") || "—"}
                    {prefs.review.length ? ` · To review: ${prefs.review.join(", ")}` : ""}
                    {prefs.neck.length ? ` · Neck: ${prefs.neck.join(", ")}` : ""}
                    {prefs.sleeve.length ? ` · Sleeve: ${prefs.sleeve.join(", ")}` : ""}
                  </p>
                  <details className="mt-3 rounded-lg border border-line bg-canvas/60 p-4">
                    <summary className="cursor-pointer text-[13px] font-semibold text-ink">{overridden ? "Change override" : "Override sizes for this profile"}</summary>
                    <div className="mt-4">
                      <SizeOverrideForm profileId={profile.id} categoryId={c.id} prefs={prefs} showNeck={c.sizeSystem === "alpha_neck_sleeve"} />
                    </div>
                  </details>
                </div>
              );
            })}
        </div>
      </section>

      <Setting title="Acceptable conditions" overridden={pv.conditionKeys === "override"} resetAction={reset("conditionKeys")} current={st.conditionKeys.map((k) => conditions.find((c) => c.key === k)?.name ?? k).join(", ") || "None"}>
        <CheckboxOverrideForm profileId={profile.id} field="conditionKeys" name="conditionKeys" options={conditions.map((c) => ({ value: c.key, label: c.name }))} selected={st.conditionKeys} />
      </Setting>

      <Setting
        title="Required materials"
        description="If set, the listing must contain at least one of these. Unknown fabric goes to review, never excluded."
        overridden={pv.requiredMaterialKeys === "override"}
        resetAction={reset("requiredMaterialKeys")}
        current={st.requiredMaterialKeys.length ? matNames(st.requiredMaterialKeys) : "None required"}
      >
        <CheckboxOverrideForm profileId={profile.id} field="requiredMaterialKeys" name="requiredMaterialKeys" options={materials.map((m) => ({ value: m.key, label: m.name }))} selected={st.requiredMaterialKeys} columns={4} />
      </Setting>

      <Setting
        title="Excluded materials"
        description={`Inherited default: materials set to “Exclude” in Preferences (${defaults.excludedMaterialKeys.length ? matNames(defaults.excludedMaterialKeys) : "none"}).`}
        overridden={pv.excludedMaterialKeys === "override"}
        resetAction={reset("excludedMaterialKeys")}
        current={st.excludedMaterialKeys.length ? matNames(st.excludedMaterialKeys) : "None excluded"}
      >
        <CheckboxOverrideForm profileId={profile.id} field="excludedMaterialKeys" name="excludedMaterialKeys" options={materials.map((m) => ({ value: m.key, label: m.name }))} selected={st.excludedMaterialKeys} columns={4} />
      </Setting>

      <Setting title="When fabric isn't stated" overridden={pv.unknownMaterialPolicy === "override"} resetAction={reset("unknownMaterialPolicy")} current={st.unknownMaterialPolicy === "review" ? "Send to Needs review" : "Allow as a match"}>
        <PolicyForm profileId={profile.id} value={st.unknownMaterialPolicy} />
      </Setting>

      <Setting title="Excluded title keywords" overridden={pv.excludeKeywords === "override"} resetAction={reset("excludeKeywords")} current={st.excludeKeywords.length ? st.excludeKeywords.join(", ") : "None"}>
        <TextOverrideForm profileId={profile.id} field="excludeKeywords" name="excludeKeywords" label="Comma-separated" value={st.excludeKeywords.join(", ")} placeholder="e.g. kids, womens" />
      </Setting>

      <div className="grid gap-6 md:grid-cols-2">
        <Setting title="Minimum item price" overridden={pv.priceMinMinor === "override"} resetAction={reset("priceMinMinor")} current={st.priceMinMinor !== null ? formatMoney(st.priceMinMinor) : "No minimum"}>
          <TextOverrideForm profileId={profile.id} field="priceMinMinor" name="value" label="USD (blank = no minimum)" value={st.priceMinMinor !== null ? String(st.priceMinMinor / 100) : ""} />
        </Setting>
        <Setting title="Maximum item price" overridden={pv.priceMaxMinor === "override"} resetAction={reset("priceMaxMinor")} current={st.priceMaxMinor !== null ? formatMoney(st.priceMaxMinor) : "No maximum"}>
          <TextOverrideForm profileId={profile.id} field="priceMaxMinor" name="value" label="USD (blank = no maximum)" value={st.priceMaxMinor !== null ? String(st.priceMaxMinor / 100) : ""} />
        </Setting>
      </div>
    </div>
  );
}
