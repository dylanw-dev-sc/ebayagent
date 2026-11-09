import Link from "next/link";
import { loadBrands, loadCategories, loadScanSettings } from "@/server/services/context";
import { suggestCorrections } from "@/server/services/corrections";
import { getFeed, getFeedFacets, getFeedNeighbors, getListingDetail, type FeedFilters, type FeedView } from "@/server/services/feed";
import { newSinceFor } from "@/server/services/visits";
import { formatDateTime } from "@/lib/format";
import { getSystemStatus } from "@/server/services/status";
import { requestDb } from "@/server/request";
import { buttonClass, EmptyState, TabLink } from "../ui";
import { DrawerShell } from "./drawer-shell";
import { DrawerNav, TriageKeys, VisitTracker } from "./triage";
import { FilterBar, SortSelect } from "./filter-bar";
import { ListingCard } from "./listing-card";
import { ListingDetail } from "./listing-detail";
import { hrefWith, parseFeedParams, type SearchParams } from "./params";

const TABS: Array<{ view: FeedView; label: string }> = [
  { view: "matches", label: "Matches" },
  { view: "review", label: "Needs review" },
  { view: "excluded", label: "Excluded" },
  { view: "all", label: "All" },
  { view: "dismissed", label: "Dismissed" },
];

/** Shared listing feed used by Product Finder (tabs) and Saved Items (fixed view). */
export async function FeedView({ basePath, searchParams, fixedView }: { basePath: string; searchParams: Promise<SearchParams>; fixedView?: FeedView }) {
  const sp = await searchParams;
  const db = await requestDb();
  const status = getSystemStatus(db);
  const source = status.dataSource;
  const trackVisits = basePath === "/finder";
  const filters: FeedFilters = {
    ...parseFeedParams(sp),
    ...(fixedView ? { view: fixedView } : {}),
    newSince: trackVisits ? newSinceFor(db, source) : null,
  };
  const feed = getFeed(db, filters, source);
  const facets = getFeedFacets(db, source);
  const listingId = Number(Array.isArray(sp.listing) ? sp.listing[0] : sp.listing);
  const detail = Number.isInteger(listingId) && listingId > 0 ? getListingDetail(db, listingId) : null;
  const neighbors = detail ? getFeedNeighbors(db, filters, source, detail.listing.id) : null;
  const neighborHref = (n: { id: number; page: number } | null | undefined) => (n ? hrefWith(basePath, sp, { listing: n.id, page: n.page > 1 ? n.page : null }) : null);
  const closeHref = hrefWith(basePath, sp, { listing: null });
  const staleAfterHours = loadScanSettings(db).staleAfterHours;
  const allBrands = detail ? loadBrands(db) : [];
  const allCategories = detail ? loadCategories(db) : [];
  const showReason = filters.view === "review" || filters.view === "excluded" || filters.view === "dismissed";
  const totalPages = Math.max(1, Math.ceil(feed.total / feed.pageSize));
  const neverScanned = !status.lastScan;

  return (
    <div className="space-y-6">
      {source === "fixture" ? (
        <div className="flex flex-col gap-1 rounded-xl border border-fixture/25 bg-fixture-soft px-4 py-3 text-[13px] leading-5 text-fixture sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong className="font-semibold">Fixture mode.</strong> These are synthetic sample listings for trying the app — not real eBay listings, prices or market data.
          </p>
          <Link href="/scans" className="shrink-0 font-semibold underline underline-offset-4">
            Connect eBay
          </Link>
        </div>
      ) : null}
      {status.otherSourceListings > 0 && source === "ebay" ? (
        <p className="text-xs text-ink-3">Fixture listings are stored but hidden while live eBay data is active.</p>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-line md:flex-row md:items-end md:justify-between">
        {!fixedView ? (
          <div className="-mb-px flex flex-wrap items-center gap-x-6">
            {TABS.map((t) => (
              <TabLink
                key={t.view}
                href={hrefWith(basePath, sp, { view: t.view === "matches" ? null : t.view, page: null, listing: null })}
                active={filters.view === t.view}
                count={t.view === "matches" ? feed.counts.matches : t.view === "review" ? feed.counts.review : t.view === "excluded" ? feed.counts.excluded : t.view === "dismissed" ? feed.counts.dismissed : undefined}
              >
                {t.label}
              </TabLink>
            ))}
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center justify-between gap-4 pb-2 md:justify-end">
          <p className="whitespace-nowrap text-[13px] text-ink-3 tabular" title="Change the window in Preferences → Scanning">
            {feed.total.toLocaleString()} {feed.total === 1 ? "listing" : "listings"}
            {filters.view !== "saved" && filters.view !== "dismissed" ? ` · posted in the last ${feed.windowDays} days` : ""}
          </p>
          <SortSelect />
        </div>
      </div>

      <FilterBar facets={facets} />
      {trackVisits ? <VisitTracker source={source} /> : null}
      {filters.newSince && (feed.newCount > 0 || filters.newOnly) ? (
        <div className="-mt-2 flex items-center gap-2 text-[13px]">
          <Link
            href={hrefWith(basePath, sp, { new: filters.newOnly ? null : "1", page: null, listing: null })}
            scroll={false}
            className={
              filters.newOnly
                ? "inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 font-medium text-white"
                : "inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 font-medium text-ink hover:bg-muted"
            }
          >
            <span className="size-1.5 rounded-full bg-match" aria-hidden />
            {filters.newOnly ? `Showing ${feed.newCount} new — show all` : `${feed.newCount} new since your last visit`}
          </Link>
          <span className="text-ink-3">First seen after {formatDateTime(filters.newSince)}</span>
        </div>
      ) : null}

      {feed.items.length === 0 ? (
        neverScanned ? (
          <EmptyState title="No listings yet">
            Run a scan to discover listings for your enabled search profiles. {source === "fixture" ? "In fixture mode the scan uses synthetic sample data." : "The scan uses the official eBay Browse API."}
          </EmptyState>
        ) : (
          <EmptyState title="Nothing here" action={<Link className={buttonClass.secondary} href={basePath}>Reset filters</Link>}>
            {filters.view === "matches"
              ? "No confirmed matches for these filters. Check Needs review for listings with missing size or fabric details."
              : "No listings match these filters."}
          </EmptyState>
        )
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-9 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {feed.items.map((item, i) => (
            <ListingCard key={item.id} item={item} detailHref={hrefWith(basePath, sp, { listing: item.id })} showReason={showReason} priority={i < 5} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-2 pt-4" aria-label="Pagination">
          {filters.page > 1 ? (
            <Link className={buttonClass.secondary} href={hrefWith(basePath, sp, { page: filters.page - 1 })}>
              Previous
            </Link>
          ) : null}
          <span className="px-3 text-sm text-ink-3 tabular">
            Page {filters.page} of {totalPages}
          </span>
          {filters.page < totalPages ? (
            <Link className={buttonClass.secondary} href={hrefWith(basePath, sp, { page: filters.page + 1 })}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}

      {detail ? (
        <DrawerShell
          closeHref={closeHref}
          label={detail.listing.title}
          nav={
            <DrawerNav
              prevHref={neighborHref(neighbors?.prev)}
              nextHref={neighborHref(neighbors?.next)}
              position={neighbors?.index !== null && neighbors?.index !== undefined ? `${neighbors.index + 1} of ${neighbors.total}` : null}
            />
          }
        >
          <TriageKeys
            listingId={detail.listing.id}
            saved={detail.userState?.saved ?? false}
            dismissed={detail.userState?.dismissed ?? false}
            reviewed={detail.userState?.reviewed ?? false}
            nextHref={neighborHref(neighbors?.next)}
            prevHref={neighborHref(neighbors?.prev)}
            closeHref={closeHref}
          />
          <ListingDetail
            d={detail}
            staleAfterHours={staleAfterHours}
            corrections={suggestCorrections({
              title: detail.listing.title,
              brandAspect: detail.listing.brandAspect,
              facts: detail.facts,
              bestProfile: detail.profiles.find((p) => p.state === detail.evaluation.state),
              brands: allBrands,
              categories: allCategories.map((c) => ({
                id: c.id,
                name: c.name,
                acceptedSizes: c.defaultSizes.accepted,
                reviewSizes: c.defaultSizes.review,
                excludeKeywords: c.excludeKeywords,
              })),
            })}
            brandOptions={allBrands.map((b) => ({ id: b.id, name: b.name }))}
          />
        </DrawerShell>
      ) : null}
    </div>
  );
}

