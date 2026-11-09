import type { Metadata } from "next";
import { Suspense } from "react";
import {
  deleteBrandAction,
  deleteCategoryAction,
  deleteGroupAction,
  deleteMaterialAction,
  setMaterialPriorityAction,
  toggleBrandAction,
  toggleCategoryAction,
  toggleConditionAction,
} from "@/app/actions/preferences";
import { ExpandableRow } from "@/components/expandable-row";
import { ActionButton, SelectAction, Toggle } from "@/components/forms";
import { BrandForm } from "@/components/preferences/brand-form";
import { CategoryForm, ConditionCreateForm, DefaultsForm, GroupForm, MaterialCreateForm, MaterialEditForm, ScanSettingsForm } from "@/components/preferences/forms";
import { Badge, PageHeader, PageSkeleton, SectionTitle, cn } from "@/components/ui";
import type { MaterialPriority } from "@/lib/domain/types";
import { minorToInput } from "@/lib/money";
import { loadBrands, loadCategories, loadConditions, loadDefaultsSetting, loadGroups, loadMaterials, loadScanSettings } from "@/server/services/context";
import { requestDb } from "@/server/request";

export const metadata: Metadata = { title: "Preferences" };

const SECTIONS = [
  ["brands", "Brands"],
  ["groups", "Brand groups"],
  ["categories", "Categories & sizes"],
  ["materials", "Materials"],
  ["conditions", "Conditions"],
  ["defaults", "Defaults"],
  ["scan", "Scanning"],
] as const;

const PRIORITY_OPTIONS: Array<{ value: MaterialPriority; label: string }> = [
  { value: "very_high", label: "Very high priority" },
  { value: "high", label: "High priority" },
  { value: "neutral", label: "Neutral" },
  { value: "avoid", label: "Generally avoid" },
  { value: "exclude", label: "Exclude" },
];

export default function PreferencesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Preferences"
        description="Your personal defaults. Search profiles inherit these unless they override a setting. Every change is saved immediately and stored listings are re-evaluated — no rescan needed."
      />
      <nav aria-label="Preference sections" className="sticky top-14 z-10 -mx-1 flex gap-1 overflow-x-auto bg-canvas/95 px-1 py-2 backdrop-blur lg:top-0">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:border-line-strong hover:text-ink">
            {label}
          </a>
        ))}
      </nav>
      <Suspense fallback={<PageSkeleton />}>
        <PreferencesContent />
      </Suspense>
    </div>
  );
}

async function PreferencesContent() {
  const db = await requestDb();
  const groups = loadGroups(db);
  const brands = loadBrands(db);
  const categories = loadCategories(db);
  const materials = loadMaterials(db);
  const conditions = loadConditions(db);
  const defaults = loadDefaultsSetting(db);
  const scan = loadScanSettings(db);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <div className="space-y-14">
      {/* Brands */}
      <section className="space-y-4">
        <SectionTitle
          id="brands"
          title={`Brands (${brands.filter((b) => b.enabled).length} of ${brands.length} enabled)`}
          description="Brands are stored once and can belong to several groups. Aliases match whole phrases; a brand inside a longer brand name (Ralph Lauren vs. Ralph Lauren Purple Label) never matches the longer one by accident."
        />
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-line bg-canvas text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Brand</th>
                  <th className="px-4 py-2.5 font-semibold">Groups</th>
                  <th className="px-4 py-2.5 font-semibold">Aliases</th>
                  <th className="px-4 py-2.5 font-semibold">Never match when</th>
                  <th className="px-4 py-2.5 font-semibold">eBay keywords</th>
                  <th className="px-4 py-2.5 font-semibold">Enabled</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {brands.map((b) => (
                  <ExpandableRow
                    key={b.id}
                    colSpan={7}
                    className={cn(!b.enabled && "bg-canvas/60 text-ink-3")}
                    cells={
                      <>
                        <td className="px-4 py-3">
                          <p className={cn("font-medium", b.enabled ? "text-ink" : "text-ink-3")}>{b.name}</p>
                          {b.notes ? <p className="mt-0.5 max-w-72 text-xs leading-4 text-ink-3">{b.notes}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-60 flex-wrap gap-1">
                            {b.groupIds.length ? b.groupIds.map((g) => <Badge key={g}>{groupName.get(g)}</Badge>) : <span className="text-xs text-ink-3">No group</span>}
                          </div>
                        </td>
                        <td className="max-w-56 px-4 py-3 text-ink-2">{b.aliases.length ? b.aliases.join(", ") : <span className="text-ink-3">—</span>}</td>
                        <td className="max-w-48 px-4 py-3 text-ink-2">{b.excludePhrases.length ? b.excludePhrases.join(", ") : <span className="text-ink-3">—</span>}</td>
                        <td className="px-4 py-3 text-ink-2">{b.searchQuery}</td>
                        <td className="px-4 py-3">
                          <Toggle checked={b.enabled} onChange={toggleBrandAction.bind(null, b.id)} label={`${b.name} enabled`} size="sm" />
                        </td>
                      </>
                    }
                    editor={
                      <div className="max-w-3xl space-y-3">
                        <BrandForm groups={groupOptions} initial={{ id: b.id, name: b.name, searchQuery: b.searchQuery, aliases: b.aliases, excludePhrases: b.excludePhrases, groupIds: b.groupIds, notes: b.notes }} />
                        <ActionButton action={deleteBrandAction.bind(null, b.id)} confirm={`Delete ${b.name}? Its pricing rules are removed too. (Disable it instead to keep it.)`} variant="danger" icon="trash">
                          Delete brand
                        </ActionButton>
                      </div>
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line bg-canvas/60 p-4">
            <p className="mb-3 text-sm font-semibold text-ink">Add a brand</p>
            <BrandForm groups={groupOptions} />
          </div>
        </div>
      </section>

      {/* Groups */}
      <section className="space-y-4">
        <SectionTitle id="groups" title="Brand groups" description="Groups make it quick to scope a search profile (e.g. “Highest-End Luxury” brands for shirts)." />
        <div className="card divide-y divide-line">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-wrap items-end gap-3 p-4">
              <div className="flex-1">
                <GroupForm initial={{ id: g.id, name: g.name, description: g.description }} />
              </div>
              <div className="flex items-center gap-3 pb-0.5">
                <span className="text-xs text-ink-3">{brands.filter((b) => b.groupIds.includes(g.id)).length} brands</span>
                <ActionButton action={deleteGroupAction.bind(null, g.id)} confirm={`Delete the group “${g.name}”? Brands are kept.`} variant="ghost" icon="trash">
                  Delete
                </ActionButton>
              </div>
            </div>
          ))}
          <div className="bg-canvas/60 p-4">
            <GroupForm />
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="space-y-4">
        <SectionTitle
          id="categories"
          title="Categories & sizes"
          description="Sizes are category-specific. Accepted sizes match only exact or unambiguous equivalents (44R = 44 Regular). “Sizes to review” are possible fits that go to Needs Review instead of being excluded — XL is never assumed to be 44R."
        />
        <div className="space-y-4">
          {categories.map((c) => (
            <div key={c.id} className={cn("card p-5", !c.enabled && "opacity-70")}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-semibold">{c.name}</p>
                  <p className="text-xs text-ink-3">
                    Accepted: <strong className="font-semibold text-ink-2">{c.defaultSizes.accepted.join(", ") || "none"}</strong>
                    {c.defaultSizes.review.length ? <> · To review: {c.defaultSizes.review.join(", ")}</> : null}
                    {c.defaultSizes.neck.length ? <> · Neck: {c.defaultSizes.neck.join(", ")}</> : null}
                    {" · "}eBay categories: {c.ebayCategoryIds.join(", ") || "none"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-3">{c.enabled ? "Enabled" : "Disabled"}</span>
                  <Toggle checked={c.enabled} onChange={toggleCategoryAction.bind(null, c.id)} label={`${c.name} enabled`} />
                </div>
              </div>
              <CategoryForm
                initial={{
                  id: c.id,
                  name: c.name,
                  noun: c.noun,
                  description: c.description,
                  sizeSystem: c.sizeSystem,
                  acceptedSizes: c.defaultSizes.accepted,
                  reviewSizes: c.defaultSizes.review,
                  neckSizes: c.defaultSizes.neck,
                  sleeveLengths: c.defaultSizes.sleeve,
                  ebayCategoryIds: c.ebayCategoryIds,
                  titleKeywords: c.titleKeywords,
                  excludeKeywords: c.excludeKeywords,
                }}
              />
              <div className="mt-3 flex justify-end">
                <ActionButton action={deleteCategoryAction.bind(null, c.id)} confirm={`Delete ${c.name}? Its pricing rules are removed too.`} variant="ghost" icon="trash">
                  Delete category
                </ActionButton>
              </div>
            </div>
          ))}
          <details className="card p-5">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Add a category</summary>
            <div className="mt-4">
              <CategoryForm />
            </div>
          </details>
        </div>
      </section>

      {/* Materials */}
      <section className="space-y-4">
        <SectionTitle
          id="materials"
          title="Materials"
          description="Priorities influence ranking; “Exclude” filters listings out. Fabric that isn't stated is never treated as a mismatch — it goes to review. Fiber composition is kept separate from seller claims like “premium”, and faux suede/leather never counts as genuine."
        />
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-line bg-canvas text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Material</th>
                  <th className="px-4 py-2.5 font-semibold">Priority</th>
                  <th className="px-4 py-2.5 font-semibold">Detected by</th>
                  <th className="px-4 py-2.5 font-semibold">Applies at</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {materials.map((m) => (
                  <ExpandableRow
                    key={m.id}
                    colSpan={5}
                    cells={
                      <>
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink">{m.name}</p>
                          {m.notes ? <p className="mt-0.5 max-w-80 text-xs leading-4 text-ink-3">{m.notes}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <SelectAction value={m.priority} options={PRIORITY_OPTIONS} onChange={setMaterialPriorityAction.bind(null, m.id)} label={`${m.name} priority`} />
                        </td>
                        <td className="max-w-72 px-4 py-3 text-xs leading-5 text-ink-2">{m.kind === "blend" ? `Blend of ${m.components.join(" + ")}` : m.keywords.join(", ")}</td>
                        <td className="px-4 py-3 text-xs text-ink-2">{m.priority === "avoid" || m.priority === "exclude" ? (m.heavyThresholdPct ? `≥ ${m.heavyThresholdPct}%` : "any amount") : "—"}</td>
                      </>
                    }
                    editor={
                      <div className="max-w-3xl space-y-3">
                        <MaterialEditForm m={{ id: m.id, name: m.name, kind: m.kind, keywords: m.keywords, components: m.components, heavyThresholdPct: m.heavyThresholdPct }} />
                        <ActionButton action={deleteMaterialAction.bind(null, m.id)} confirm={`Delete ${m.name}?`} variant="danger" icon="trash">
                          Delete material
                        </ActionButton>
                      </div>
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line bg-canvas/60 p-4">
            <p className="mb-3 text-sm font-semibold text-ink">Add a material</p>
            <MaterialCreateForm />
          </div>
        </div>
      </section>

      {/* Conditions */}
      <section className="space-y-4">
        <SectionTitle id="conditions" title="Acceptable conditions" description="Turn off conditions you don't want. Profiles inherit this list unless they override it." />
        <div className="card divide-y divide-line">
          {conditions.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{c.name}</p>
                <p className="text-xs text-ink-3">eBay condition ID {c.ebayConditionIds.join(", ") || "—"}</p>
              </div>
              <Toggle checked={c.accepted} onChange={toggleConditionAction.bind(null, c.id)} label={`Accept ${c.name}`} />
            </div>
          ))}
          <div className="bg-canvas/60 p-4">
            <ConditionCreateForm />
          </div>
        </div>
      </section>

      {/* Defaults */}
      <section className="space-y-4">
        <SectionTitle id="defaults" title="Other defaults" />
        <div className="card p-5">
          <DefaultsForm
            d={{
              unknownMaterialPolicy: defaults.unknownMaterialPolicy,
              excludeKeywords: defaults.excludeKeywords,
              priceMin: minorToInput(defaults.priceMinMinor),
              priceMax: minorToInput(defaults.priceMaxMinor),
            }}
          />
        </div>
      </section>

      {/* Scan settings */}
      <section className="space-y-4 pb-10">
        <SectionTitle id="scan" title="Scanning" description="How scans use eBay's API: page sizes, call budget and data retention. eBay credentials are set in .env.local, never here." />
        <div className="card p-5">
          <ScanSettingsForm s={scan} />
        </div>
      </section>
    </div>
  );
}
