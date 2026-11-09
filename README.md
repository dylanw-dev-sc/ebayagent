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
| Account-deletion notifications or exemption | No seller or buyer data is stored. The optional seller-feedback minimum is checked while a scan runs, then discarded. |
| No use of eBay content to train algorithms or ML models | Matching is deterministic rules only; no machine learning. |

Product images are shown directly from eBay's image CDN and are never copied or re-hosted.

## What you can do

- **Product Finder:** an image grid with *Matches*, *Needs review*, *Excluded*, *All* and *Dismissed* tabs.
  - Filter by brand, category, size, material, price eligibility, review status, search profile or title text.
  - Sort by newly listed, lowest or highest total price, or material preference.
  - Each card shows the brand, title, size, fabric, condition, price, shipping, total, match state, price eligibility and an eBay link, plus save, dismiss and mark-reviewed controls.
  - **New since your last visit:** listings found since your previous visit get a *New* badge, and a chip above the grid shows only those. A visit is a browsing session: badges stay put while you look around, and a new session starts after 30 minutes away.
  - The detail panel shows a full-size photo gallery, every fact with its source (including measurements and red-flag checks), the decision for each profile with reasons, the Cost Evaluator's reasoning, and a product-level price override.
  - **Fix the rule from the listing:** under *Wrong decision? Fix the rule*, the detail panel offers one-click fixes for what it just decided (see [Fixing a wrong decision](#fixing-a-wrong-decision)).
  - **Keyboard triage** in the detail panel, with previous/next buttons and a position counter ("3 of 41") that follow the current tab, filters and sort across pages:

    | Key | Action |
    | --- | --- |
    | `S` | Save / unsave |
    | `D` | Dismiss and go to the next listing (on a dismissed listing: restore it) |
    | `R` | Mark reviewed and go to the next listing (on a reviewed listing: unmark it) |
    | `J` or `→` | Next listing |
    | `K` or `←` | Previous listing |
    | `Esc` | Close |

    Shortcuts are ignored while you type in a field, and while the photo gallery has focus (there the arrow keys flip photos).
- **Cost Evaluator:** a pricing-rules editor with a live max-price preview, plus *Price-eligible*, *Over ceiling (excluded)* and *Needs pricing review* lists. Each listing shows exactly why it passed or failed.
  - **Brand × category grid** (*Rules → Brand × category grid*): one row per brand plus a category-wide row, with retail and allowed % per category. Set a default % once and enter only retail prices. A cleared cell removes that rule, and everything is recalculated once on save.
  - **CSV import/export:** download your rules, or a template with a row for every enabled brand × category, fill it in a spreadsheet, and import it. Rows with a blank retail price are skipped (never deleted or filled in), existing rules are updated, and problems are reported by line number. Brands can be written as their name or any alias, and *All brands* means the category-wide rule.
- **Saved Items:** everything you saved. Saved marks persist across sessions and rescans.
- **Search Profiles:** create, edit, enable/disable, duplicate and delete. Every setting shows whether it is **Inherited** or an **Override**, with "Reset to default".
- **Preferences:** brands (groups, aliases, exclusion phrases, eBay search keywords, enable/disable), brand groups, categories (category-specific sizes, measurement ranges, exclude keywords, eBay category mapping), material priorities, acceptable conditions, defaults (including counterfeit red-flag phrases) and scan settings (including the listing window and optional seller-feedback minimums).
- **Scans & Status:** connection test, data mode (live or fixture), call usage, scan history with per-scan counts and errors, re-evaluation and clearing fixture data.

## Initial profile (seeded once, fully editable)

| Seeded item | Initial values |
| --- | --- |
| Brands | 36 brands in three groups (Valstar and Todd Snyder belong to two). |
| Categories | Shirts (T-shirts, polos), Button-Down Shirts (casual and dress, with neck/sleeve support), Jackets & Outerwear (coats/jackets plus blazers/sport coats). |
| Sizes | L/XL for shirts and button-downs; 44R for jackets. XL jackets go to *Needs review*, never assumed to be 44R. |
| Measurement ranges | **None.** Fit by measurements stays off until you enter your own ranges. |
| Counterfeit red flags | Phrases like *replica*, *1:1*, *dupe* and *inspired by*; listings containing one are excluded. |
| Seller minimums | **Off.** |
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

### Counterfeit red flags

Listings whose title or description contains a red-flag phrase are **excluded** by default, with the phrase as the reason: *replica*, *1:1*, *dupe*, *inspired by*, *in the style of*, *homage*, *mirror quality*, *AAA quality*, *fake*, *counterfeit*, *knockoff*, *not authentic*, *bootleg* and a few variants.

- Negated mentions don't count: "100% authentic, not a replica" is not flagged.
- Edit the phrases and choose the policy in *Preferences → Other defaults*: **exclude**, send to **review**, or just **flag** (a badge and a note, decision unchanged).
- This is a phrase check, not authentication. A listing without red flags can still be counterfeit.

### Sizes

Sizes are category-specific. Only unambiguous equivalents count as equal (44R = "44 Regular" = "44 Reg").

These go to **Needs review** instead of being matched:
- EU/IT sizes (IT 54 ≈ US 44)
- a chest size with no length ("44")
- sizes you listed under "Sizes to review"
- listings with no size
- neck/sleeve sizes while you haven't set accepted neck sizes

A different size is **excluded** with a reason, e.g. *"Excluded: jacket is size 40R, your accepted size is 44R."*

### Fit by measurements

Labels vary by maker, so you can also judge fit by the seller's flat measurements. In *Preferences → Categories & sizes*, give a category a range (inches) for any of: **pit to pit** (chest), **length**, **shoulders**, **sleeve**. Nothing is set by default.

The app reads measurements stated in the title or description, such as "Pit to pit 22.5 in", "P2P: 24.5\"" or "Pit-to-pit approx. 56 cm". Centimeters are converted. A "chest" figure too large to be a flat measurement is treated as the full circumference and halved. Implausible numbers are ignored, and so are center-back sleeve measurements.

How measurements combine with the size label:

| Size label | Measurements fit your ranges | Measurements fall outside |
| --- | --- | --- |
| Accepted | Match | Needs review |
| Unclear (e.g. IT 54, no size) | **Match** | Excluded |
| Different size | Needs review | Excluded |

Any stated measurement outside its range counts as outside. When you set a chest range, a listing also needs a chest measurement to count as fitting. A listing without enough measurements is decided by its size label alone.

### Materials

Fiber composition is parsed from item specifics, titles and the seller's description: percentages in either order, blends, linings ignored, and "merino" counted as wool. From descriptions, only composition-style sentences are read (a percentage, or words like "fabric", "material", "composition", "shell"), and packaging mentions like "ships in a poly mailer" don't count, so seller boilerplate doesn't create false matches.

Photos are **never** read automatically. When no fabric is stated, the listing goes to *Needs review*, and the detail view's photo gallery makes it quick to check a care-label shot yourself.

- **Faux materials** don't count as the real thing: "faux suede", microsuede, Ultrasuede, Alcantara, PU or vegan leather, and phrases like "cashmere feel" or "silk screen".
- **Seller claims** ("premium", "luxury") are recorded separately and never treated as facts.
- **Missing fabric** goes to *Needs review*, never to exclusion, and the reason says where the app looked (title, item specifics, description). This is configurable per profile.
- **Priorities** affect ranking. "Exclude" filters listings out; "Generally avoid" applies at ≥ 50% by default.

### Prices

- **Precedence:** product override → brand + category rule → category-wide rule.
- **Unknown shipping** is never assumed free. Such listings go to *Needs pricing review*, unless the item price alone already exceeds the ceiling.
- **Currencies** are not compared without conversion.
- **Auctions** (off by default, eBay's default) are evaluated on the current bid and labeled.
- **Bulk setup** (grid or CSV) creates the same rules as the single-rule editor, so precedence and the "never invent retail prices" rule are unchanged.

### Fixing a wrong decision

When a listing is decided wrongly, the detail panel's *Wrong decision? Fix the rule* section offers the fixes that apply to that listing. Each one is a single click, and every stored listing is re-evaluated at once, with no new scan.

| Situation | Offered fix |
| --- | --- |
| The item specifics name a brand the app doesn't recognize | Add it as an alias of one of your brands |
| A brand matched that shouldn't have | Add a never-match phrase to that brand |
| The size was excluded or sent to review | Accept the size for this category, or send it to review instead of excluding it |
| The size matched but you don't want it | Stop accepting it |
| The listing isn't really this kind of garment | Add an exclude keyword to the category |

Fixes change your preferences (category or brand settings), so they apply to every profile that inherits them. A profile override still wins, as usual.

## Scanning

1. **Plan:** enabled profiles become (brand × eBay category) queries, deduplicated across profiles. eBay allows one category per search.
2. **Fetch:** each query is sorted `newlyListed`, uses up to 200 results per page, and asks eBay only for listings posted within the **listing window** (default: the last 7 days, via the `itemStartDate` filter). Paging stops at the window edge, or earlier at the previous scan's newest listing minus a look-back (eBay can index new listings late).
3. **Store:** listings are deduplicated by eBay item ID and stored as new, updated or unchanged. Unchanged listings aren't re-processed unless your rules changed. Listings from sellers below your optional feedback minimums are skipped (see below).
4. **Enrich:** item details (brand, size, material, description) are fetched for undecided listings, within a per-scan limit. This includes stored listings that a rule change made relevant: for example, after you accept a new size, the next scan fetches the fabric details of listings in that size.
5. **Evaluate:** the matching and pricing engines run, and their decisions are stored.
6. **Record:** each run's examined, new, updated, matched, review and rejected counts, errors, rate-limit stops and purges are saved.

### Listing window

Only listings **posted in the last 7 days** are considered (change it in *Preferences → Scanning*, 1–30 days):

- "Posted" is eBay's original listing date, the same date eBay's own "newly listed" sort uses. A relisted item counts from when it was first listed.
- Older listings are skipped even if eBay returns them, are counted in the scan history, and are removed once they age out. **Saved items are kept** and stay in *Saved Items*.
- Finder views (except Saved and Dismissed) and the Cost Evaluator lists show only the window.
- Changing the window resets the scan bookmarks, so the next scan covers the whole new window.

The window mostly saves work rather than time. The first scan no longer pages back through old listings, and the item-detail budget is spent only on recent listings. Each scan still makes one search per brand × eBay category, which is where most of the time goes.

If a scan is interrupted, it is marked *interrupted*; results up to the last completed page are kept. Only one scan runs at a time.

### Seller minimums (optional)

In *Preferences → Scanning* you can set a minimum seller feedback score and/or positive-feedback percentage. Both are off by default.

- They are checked while the scan runs, from the feedback eBay includes in search results. Seller names and feedback are **never stored**.
- A listing whose seller feedback isn't reported is never skipped.
- Skipped listings are counted in the scan history. Changing a minimum resets the scan bookmarks, so the next scan re-checks the whole window and removes stored listings from sellers below the new minimum, **unless you saved them**.

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
  matching/     brand · size · measurements · material · red flags · category/condition → engine (per-profile decisions)
  pricing/      Cost Evaluator engine (integer cents, exact ceiling comparison)
  profiles/     inheritance resolver (defaults + overrides → effective settings with provenance)
  providers/    ListingProvider interface · ebay/ (OAuth, Browse, mapping, errors) · fixture/
src/server/
  db/           Drizzle schema, migrations runner, one-time seed
  services/     preferences, profiles, pricing rules (+ grid/CSV), evaluation, feed queries, corrections, visits, user state, status
  scanner/      query planning, incremental rate-limit-aware scan runner, provider selection
src/app/        Next.js App Router pages, server actions, API routes (/api/scan, /api/status, /api/pricing-rules CSV)
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
- measurement reading (units, circumference, implausible values) and how measurements combine with size labels
- counterfeit red flags, including negated mentions, and seller-feedback minimums
- one-click corrections and the re-evaluation they trigger
- "new since your last visit" sessions and previous/next across pages
- the pricing grid and CSV import/export (quoting, formula-injection guard, per-line errors, round trip)

Two optional browser tests drive the running app (each needs Playwright and its own scratch fixture database; see the file headers):
- `e2e/smoke.mjs`: save, dismiss and review; pricing rules; brand and material edits; profile overrides; the detail drawer; and scanning.
- `e2e/features.mjs`: fit by measurements, red flags, one-click corrections, keyboard triage, the pricing grid and CSV import.

## Known limitations

- **Live eBay access is unverified here:** the provider is built to eBay's documented contract and tested against mocked responses, but has not yet made a real call. See [Is access guaranteed?](#is-access-guaranteed).
- **Call volume:** with the seeded profile, one scan plans ~216 searches (36 brands × 6 eBay categories) plus detail calls. That fits several scans a day within 5,000 calls; scanning more often needs a higher limit (eBay's free Application Growth Check) or fewer brands/categories.
- **Relisted items** count from their original listing date, so an old unsold item relisted this week is skipped.
- **Fabric in photos only** (e.g. a care-label shot) is not read automatically; such listings stay in *Needs review*. The same goes for measurements shown only in photos.
- **Red flags are phrases, not authentication.** They catch sellers who say what they're selling; they can't spot an undisclosed fake.
- **Most live search results need item details** for size and fabric. Details beyond the per-scan limit (default 100) fall back to the title, so more listings land in *Needs review*.
- **Sizes beyond the configured rules** are converted only by those rules (IT/EU jacket sizes ≈ US + 10 go to review). Other systems (Japanese sizing, etc.) are not converted.
- **USD only:** the US marketplace is targeted and other currencies aren't converted; they go to *Needs pricing review*.
- **Single-user, local:** no authentication. Don't expose the server to the internet as-is.
