# eBay Clothing Finder

A personal shopping-intelligence app that discovers newly listed eBay clothing from your preferred brands, checks each listing against your sizes, fabrics and conditions, and filters out anything priced above your own retail-based ceiling, then presents the results as a clean, image-first catalog.

It is **read-only**: it never buys, bids or makes offers. It only discovers, evaluates, organizes and links to listings on eBay.

- **Product Finder (engine 1):** a deterministic matching engine judges brand, category, size, material, condition and per-profile rules, and every listing gets one of three states (*Match*, *Needs review*, *Not a match*) with a plain-language reason.
- **Cost Evaluator (engine 2):** an independent engine computes `max secondhand price = reference retail × allowed %` and compares it with `item price + shipping`, using exact integer-cent arithmetic.

Both engines read the same stored listing data, so either one can be re-run without calling eBay again.

---

## Quick start

Requirements: Node.js 20.9+ (22 recommended) and npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. With no eBay credentials the app runs in **Fixture mode**: synthetic sample listings, labeled "Fixture" everywhere, that let you try every feature. Click **Run fixture scan** in the sidebar. Each later fixture scan releases a few "new" sample listings, so incremental discovery is visible.

Your data lives in a local SQLite file (`data/ebay-finder.db`, git-ignored). Delete that file to start over; it is recreated and re-seeded with your initial clothing profile on the next start.

For a production build:

```bash
npm run build && npm run start
```

## Connecting the official eBay API

The app uses eBay's **Buy › Browse API** (`item_summary/search` and `getItem`) with an OAuth *application* token. It never scrapes eBay pages.

1. Create a free developer account at <https://developer.ebay.com> and open **Application Keys**.
2. Create a **Production** keyset. Before production keys activate, eBay requires every app to either subscribe to **Marketplace Account Deletion/Closure notifications** or claim an exemption. This app stores no eBay user (seller) data, so the exemption ("not persisting eBay data") is the matching choice. Read eBay's wording before you confirm.
3. Copy `.env.example` to `.env.local` and set:
   - `EBAY_CLIENT_ID`: the keyset's *App ID (Client ID)*
   - `EBAY_CLIENT_SECRET`: the keyset's *Cert ID (Client Secret)*
   - optionally `EBAY_DELIVERY_ZIP`, so eBay can return calculated-shipping estimates
4. Restart the app, then verify access:

   ```bash
   npm run ebay:check
   ```

   This mints a token and makes a single search call (limit 1). It reports remaining daily calls when eBay's Developer Analytics API provides them. You can also use **Scans & Status → Test eBay connection**.

### Is access guaranteed?

No, and the app does not assume it is. eBay's documentation is not consistent on this point (checked November 2026):

- eBay's *Buy APIs requirements* page says production access to Buy APIs is applied for through the **eBay Partner Network** and is not guaranteed.
- The Browse API's `search` and `getItem` methods are **not** marked "Limited Release" (bulk `getItems` is). Developers report they work with a standard production keyset.

The decisive test is `npm run ebay:check`:

| Result | Meaning |
| --- | --- |
| OK | Live scanning works. |
| `auth` / `invalid_client` | Wrong ID or secret, or a sandbox/production keyset mix-up. |
| `access_denied` (HTTP 403, errorId 1100) | Your keyset isn't enabled for the Browse API. Apply for Buy API production access via the eBay Partner Network, then retry. |
| `rate_limited` (HTTP 429, errorId 2001) | The daily call limit is reached. |

While eBay access isn't available, everything else works in fixture mode.

### Sandbox

Set `EBAY_ENVIRONMENT=sandbox` with sandbox keys to exercise the live code path against eBay's test data. Sandbox listings are not real listings.

## How the app follows eBay's API rules

| eBay rule (API License Agreement / Buy API docs) | What the app does |
| --- | --- |
| Use official APIs, within call limits (Browse default: 5,000 calls/day) | Official Browse API only. A rolling 24-hour **call budget** (default 5,000) stops scans before the limit. On HTTP 429 the scan stops immediately and keeps partial results. Tokens are cached, since eBay also limits how many tokens an app may mint per day. |
| Displayed listing data must be ≤ 6 hours older than eBay's, or its age must be disclosed | Every listing records *last checked*. Data older than 6 hours is labeled with its age on the card and in the detail view. Saved listings are re-checked during scans. |
| Delete eBay content once it is no longer publicly available; keep copies only as long as needed (≤ 30 days after a deletion trigger) | Listings reported as ended are deleted. Listings not re-confirmed within the retention window (default 14 days, max 30) are purged. Your saved/dismissed marks are stored separately and survive. |
| Account-deletion notifications or exemption | No seller or buyer data is stored. |
| No use of eBay content to train algorithms or ML models | Matching is deterministic rules only; no machine learning. |

Product images are shown directly from eBay's image CDN and are never copied or re-hosted.

## What you can do

- **Product Finder:** an image grid with *Matches*, *Needs review*, *Excluded*, *All* and *Dismissed* tabs.
  - Filter by brand, category, size, material, price eligibility, review status, search profile or title text.
  - Sort by newly listed, lowest or highest total price, or material preference.
  - Each card shows the brand, title, size, fabric, condition, price, shipping, total, match state, price eligibility and an eBay link, plus save, dismiss and mark-reviewed controls.
  - The detail panel shows every fact with its source, the decision for each profile with reasons, the Cost Evaluator's reasoning, and a product-level price override.
- **Cost Evaluator:** a pricing-rules editor with a live max-price preview, plus *Price-eligible*, *Over ceiling (excluded)* and *Needs pricing review* lists. Each listing shows exactly why it passed or failed.
- **Saved Items:** everything you saved. Saved marks persist across sessions and rescans.
- **Search Profiles:** create, edit, enable/disable, duplicate and delete. Every setting shows whether it is **Inherited** or an **Override**, with "Reset to default".
- **Preferences:** brands (groups, aliases, exclusion phrases, eBay search keywords, enable/disable), brand groups, categories with category-specific sizes and eBay category mapping, material priorities, acceptable conditions, defaults and scan settings.
- **Scans & Status:** connection test, data mode (live or fixture), call usage, scan history with per-scan counts and errors, re-evaluation and clearing fixture data.

## Initial profile (seeded once, fully editable)

| Seeded item | Initial values |
| --- | --- |
| Brands | 36 brands in three groups (Valstar and Todd Snyder belong to two). |
| Categories | Shirts (T-shirts, polos), Button-Down Shirts (casual and dress, with neck/sleeve support), Jackets & Outerwear (coats/jackets plus blazers/sport coats). |
| Sizes | L/XL for shirts and button-downs; 44R for jackets. XL jackets go to *Needs review*, never assumed to be 44R. |
| Materials | Your very-high, high and avoid priorities. |
| Conditions | All conditions accepted. |
| Search profiles | All Preferences, Luxury Shirts, Heritage Jackets, Premium Button-Downs. |
| Pricing rules | **None.** Retail baselines are yours to enter; the app never invents retail prices or depreciation rates. |

The eBay US category IDs come from eBay's own category pages: 15687 T-Shirts, 185101 Polos, 57990 Casual Button-Down Shirts, 57991 Dress Shirts, 57988 Coats, Jackets & Vests, and 3001 Suits & Suit Separates. Blazers moved into 3001 when 3002 was retired.

The seed runs **once per database**. Restarts never overwrite your edits, and a forced re-seed adds no duplicates.

## How decisions are made

### Brands

- **Matching:** names and aliases match as whole phrases, ignoring case, accents and punctuation (`A.P.C.` = `APC`, `Officine Générale` = `Officine Generale`).
- **Longest match wins.** Plain Ralph Lauren never matches *Ralph Lauren Purple Label*. "Ralph Lauren Black Label Purple shirt" and *The North Face Purple Label* don't match either.
- **Never-match phrases:** a listing containing one of a brand's phrases never matches that brand. The seeds are *Z Zegna* (Zegna's diffusion line) and *Jack Nicklaus* (the unrelated "Golden Bear" golf brand).
- **Fabric-mill mentions** (e.g. "Suitsupply blazer in Loro Piana wool") are sent to review, not counted as the garment brand.
- **Conflicts:** item specifics that disagree with the title go to review.

### Sizes

Sizes are category-specific. Only unambiguous equivalents count as equal (44R = "44 Regular" = "44 Reg").

These go to **Needs review** instead of being matched:
- EU/IT sizes (IT 54 ≈ US 44)
- a chest size with no length ("44")
- sizes you listed under "Sizes to review"
- listings with no size
- neck/sleeve sizes while you haven't set accepted neck sizes

A different size is **excluded** with a reason, e.g. *"Excluded: jacket is size 40R, your accepted size is 44R."*

### Materials

Fiber composition is parsed from item specifics and titles: percentages in either order, blends, linings ignored, and "merino" counted as wool.

- **Faux materials** don't count as the real thing: "faux suede", microsuede, Ultrasuede, Alcantara, PU or vegan leather, and phrases like "cashmere feel" or "silk screen".
- **Seller claims** ("premium", "luxury") are recorded separately and never treated as facts.
- **Missing fabric** goes to *Needs review*, never to exclusion. This is configurable per profile.
- **Priorities** affect ranking. "Exclude" filters listings out; "Generally avoid" applies at ≥ 50% by default.

### Prices

- **Precedence:** product override → brand + category rule → category-wide rule.
- **Unknown shipping** is never assumed free. Such listings go to *Needs pricing review*, unless the item price alone already exceeds the ceiling.
- **Currencies** are not compared without conversion.
- **Auctions** (off by default, eBay's default) are evaluated on the current bid and labeled.

## Scanning

1. **Plan:** enabled profiles become (brand × eBay category) queries, deduplicated across profiles. eBay allows one category per search.
2. **Fetch:** each query is sorted `newlyListed`, uses up to 200 results per page, and stops early at the previous scan's newest listing, minus a look-back window (eBay can index new listings late).
3. **Store:** listings are deduplicated by eBay item ID and stored as new, updated or unchanged. Unchanged listings aren't re-processed unless your rules changed.
4. **Enrich:** item details (brand, size, material) are fetched for undecided listings, within a per-scan limit.
5. **Evaluate:** the matching and pricing engines run, and their decisions are stored.
6. **Record:** each run's examined, new, updated, matched, review and rejected counts, errors, rate-limit stops and purges are saved.

If a scan is interrupted, it is marked *interrupted*; results up to the last completed page are kept. Only one scan runs at a time.

### Scheduling (later)

Scans are not tied to the UI. To scan while you're away, run the CLI on a schedule:

```bash
npm run scan
```

For example, as a crontab entry every 2 hours (mind the daily call budget):

```bash
0 */2 * * * cd /path/to/ebay-clothing-finder && npm run scan >> scan.log 2>&1
```

You can also `POST /api/scan` on a running server.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the automated test suite (Vitest) |
| `npm run typecheck` | Run the TypeScript check |
| `npm run lint` | Run ESLint |
| `npm run scan` | Run one scan from the command line (same provider selection as the app) |
| `npm run ebay:check` | Verify eBay credentials and Browse access |
| `npm run db:setup` | Create, migrate and seed the database, and re-evaluate stored listings |
| `npm run db:generate` | Generate a new SQL migration after changing `src/server/db/schema.ts` |

### Architecture

```
src/lib/        Pure logic, no database or network: shared by app, CLI and tests
  matching/     brand · size · material · category/condition → engine (per-profile decisions)
  pricing/      Cost Evaluator engine (integer cents, exact ceiling comparison)
  profiles/     inheritance resolver (defaults + overrides → effective settings with provenance)
  providers/    ListingProvider interface · ebay/ (OAuth, Browse, mapping, errors) · fixture/
src/server/
  db/           Drizzle schema, migrations runner, one-time seed
  services/     preferences, profiles, pricing rules, evaluation, feed queries, user state, status
  scanner/      query planning, incremental rate-limit-aware scan runner, provider selection
src/app/        Next.js App Router pages, server actions, API routes (/api/scan, /api/status)
tests/          Vitest suites (engines, scanner, eBay provider via mocked HTTP, persistence)
drizzle/        SQL migrations
scripts/        CLI entry points (scan, ebay:check, db:setup)
```

Data acquisition (`providers/`) is kept separate from the business rules (`matching/`, `pricing/`). A different data source, such as a hosted scanning worker, only needs to implement `ListingProvider`.

### Tests

`npm test` runs the automated suite. It covers:
- brand aliases and brand-family traps
- category-specific sizes and 44R equivalents, plus missing or ambiguous sizes
- fabric preferences and exclusions, missing fabrics, faux materials and seller claims
- duplicate listings and listings that match several profiles
- pricing precedence, threshold boundaries and shipping, plus missing retail or shipping data
- profile inheritance and overrides
- recalculation after rule changes, without API calls
- saved and dismissed states
- eBay errors (auth, access denied, rate limits, 5xx) via mocked HTTP; empty results; interrupted scans; the call budget
- restart persistence and idempotent seeding

`e2e/smoke.mjs` is an optional browser smoke test of the main UI workflows: save, dismiss and review; pricing rules; brand and material edits; profile overrides; the detail drawer; and scanning. It needs Playwright and a scratch fixture database; see the file header.

## Known limitations

- **Live eBay access is unverified here:** the provider is built to eBay's documented contract and tested against mocked responses, but has not yet made a real call. See [Is access guaranteed?](#is-access-guaranteed).
- **Call volume:** with the seeded profile, one scan plans ~216 searches (36 brands × 6 eBay categories) plus detail calls. That fits several scans a day within 5,000 calls; scanning more often needs a higher limit (eBay's free Application Growth Check) or fewer brands/categories.
- **Most live search results need item details** for size and fabric. Details beyond the per-scan limit (default 100) fall back to the title, so more listings land in *Needs review*.
- **Sizes beyond the configured rules** are converted only by those rules (IT/EU jacket sizes ≈ US + 10 go to review). Other systems (Japanese sizing, etc.) are not converted.
- **USD only:** the US marketplace is targeted and other currencies aren't converted; they go to *Needs pricing review*.
- **Single-user, local:** no authentication. Don't expose the server to the internet as-is.
