import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { deleteProfileAction, duplicateProfileAction, toggleProfileAction } from "@/app/actions/profiles";
import { ActionButton, Toggle } from "@/components/forms";
import { CreateProfileForm } from "@/components/profiles/override-forms";
import { Badge, PageHeader, PageSkeleton, buttonClass, cn } from "@/components/ui";
import * as s from "@/server/db/schema";
import { loadBrands, loadCategories, loadGroups } from "@/server/services/context";
import { listingWindowStart } from "@/server/services/feed";
import { listProfiles } from "@/server/services/profiles";
import { getSystemStatus } from "@/server/services/status";
import { requestDb } from "@/server/request";

export const metadata: Metadata = { title: "Search Profiles" };

export default function ProfilesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Search Profiles"
        description="Saved searches that inherit your personal defaults and override only what they need. A listing that fits several profiles appears once in the feed with every matching profile recorded."
      />
      <Suspense fallback={<PageSkeleton />}>
        <ProfilesContent />
      </Suspense>
    </div>
  );
}

function Provenance({ override }: { override: boolean }) {
  return override ? <Badge tone="ink">Override</Badge> : <Badge>Inherited</Badge>;
}

async function ProfilesContent() {
  const db = await requestDb();
  const profiles = listProfiles(db);
  const brands = loadBrands(db);
  const categories = loadCategories(db);
  const groups = loadGroups(db);
  const source = getSystemStatus(db).dataSource;
  const matchCounts = new Map(
    db
      .all<{ profileId: number; state: string; n: number }>(
        sql`select m.profile_id as profileId, m.state as state, count(*) as n from ${s.listingProfileMatches} m join ${s.listings} l on l.id = m.listing_id where l.source = ${source} and coalesce(l.origin_at, l.listed_at, l.first_seen_at) >= ${listingWindowStart(db).getTime()} group by m.profile_id, m.state`,
      )
      .map((r) => [`${r.profileId}:${r.state}`, Number(r.n)]),
  );

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <CreateProfileForm />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {profiles.map((p) => {
          const st = p.resolved.settings;
          const pv = p.resolved.provenance;
          const scope = p.overrides.brandScope;
          const brandText = scope
            ? [
                ...scope.groupIds.map((g) => groups.find((x) => x.id === g)?.name).filter(Boolean),
                ...(scope.brandIds.length ? [`${scope.brandIds.length} individual brand${scope.brandIds.length > 1 ? "s" : ""}`] : []),
              ].join(" + ") || "No brands selected"
            : "All enabled brands";
          const sizeOverrides = Object.values(p.resolved.sizeProvenance).filter((x) => x === "override").length;
          const overrides = Object.values(pv).filter((x) => x === "override").length + sizeOverrides;
          return (
            <article key={p.id} className={cn("card flex flex-col p-5", !p.enabled && "opacity-70")}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-display text-2xl font-semibold text-ink">{p.name}</h2>
                  {p.description ? <p className="mt-1 text-sm text-ink-2">{p.description}</p> : null}
                </div>
                <Toggle checked={p.enabled} onChange={toggleProfileAction.bind(null, p.id)} label={`${p.name} enabled`} />
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="text-ink-3">Brands</dt>
                <dd className="flex flex-wrap items-center gap-2 text-ink-2">
                  {brandText} <span className="text-ink-3">({st.brandIds.length})</span> <Provenance override={pv.brandScope === "override"} />
                </dd>
                <dt className="text-ink-3">Categories</dt>
                <dd className="flex flex-wrap items-center gap-2 text-ink-2">
                  {st.categoryIds.map((id) => categories.find((c) => c.id === id)?.name).join(", ") || "None"} <Provenance override={pv.categoryIds === "override"} />
                </dd>
                <dt className="text-ink-3">Sizes</dt>
                <dd className="flex flex-wrap items-center gap-2 text-ink-2">
                  {st.categoryIds
                    .map((id) => `${categories.find((c) => c.id === id)?.name}: ${st.sizes[id]?.accepted.join("/") || "—"}`)
                    .join(" · ")}{" "}
                  <Provenance override={sizeOverrides > 0} />
                </dd>
                <dt className="text-ink-3">Fabric unknown</dt>
                <dd className="flex items-center gap-2 text-ink-2">
                  {st.unknownMaterialPolicy === "review" ? "Needs review" : "Allowed"} <Provenance override={pv.unknownMaterialPolicy === "override"} />
                </dd>
              </dl>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-xs text-ink-3">
                  {(matchCounts.get(`${p.id}:match`) ?? 0).toLocaleString()} matches · {(matchCounts.get(`${p.id}:review`) ?? 0).toLocaleString()} to review · {overrides} override{overrides === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/finder?profile=${p.id}`} className={buttonClass.ghost}>
                    View matches
                  </Link>
                  <ActionButton action={duplicateProfileAction.bind(null, p.id)} variant="ghost">
                    Duplicate
                  </ActionButton>
                  <ActionButton action={deleteProfileAction.bind(null, p.id)} confirm={`Delete the profile “${p.name}”?`} variant="ghost" icon="trash">
                    Delete
                  </ActionButton>
                  <Link href={`/profiles/${p.id}`} className={buttonClass.secondary}>
                    Edit
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {profiles.length === 0 ? <p className="text-sm text-ink-3">No profiles yet. Scans need at least one enabled profile.</p> : null}
      <p className="text-xs text-ink-3">{brands.filter((b) => b.enabled).length} brands are enabled in Preferences.</p>
    </div>
  );
}
