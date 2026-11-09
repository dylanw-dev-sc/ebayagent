import { and, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { normalizePhrase, stripAccents } from "../../lib/text";
import type { ProfileOverrides } from "../../lib/profiles/resolve";
import * as schema from "./schema";
import {
  SEED_VERSION,
  seedBrands,
  seedCategories,
  seedColors,
  seedConditions,
  seedDefaults,
  seedGroups,
  seedMaterials,
  seedPricingSettings,
  seedProfiles,
  seedScanSettings,
} from "./seed-data";

type Db = BetterSQLite3Database<typeof schema>;

/** eBay keyword query derived from a brand name: accents and periods removed. */
export function defaultSearchQuery(name: string): string {
  return stripAccents(name).replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/**
 * Idempotent seed.
 *
 * - Runs only when the database has never been seeded (meta.seed_version absent),
 *   so restarts never re-add rows the user deleted or touch rows the user edited.
 * - Every insert is keyed by a natural key (name / slug / key) and skips rows that
 *   already exist, so even a forced re-run cannot create duplicates or overwrite edits.
 */
export function seedDatabase(db: Db, opts: { force?: boolean } = {}): { seeded: boolean } {
  const existing = db.select().from(schema.meta).where(eq(schema.meta.key, "seed_version")).get();
  if (existing && !opts.force) return { seeded: false };

  db.transaction((tx) => {
    // Brand groups
    for (const g of seedGroups) {
      tx.insert(schema.brandGroups).values(g).onConflictDoNothing({ target: schema.brandGroups.name }).run();
    }
    const groupIdByName = new Map(tx.select().from(schema.brandGroups).all().map((g) => [g.name, g.id]));

    // Brands, aliases, memberships
    for (const b of seedBrands) {
      const normalizedName = normalizePhrase(b.name);
      let row = tx.select().from(schema.brands).where(eq(schema.brands.normalizedName, normalizedName)).get();
      if (!row) {
        row = tx
          .insert(schema.brands)
          .values({
            name: b.name,
            normalizedName,
            searchQuery: b.searchQuery ?? defaultSearchQuery(b.name),
            excludePhrases: b.excludePhrases ?? [],
            notes: b.notes ?? null,
          })
          .returning()
          .get();
        for (const alias of b.aliases ?? []) {
          tx.insert(schema.brandAliases)
            .values({ brandId: row.id, alias, normalizedAlias: normalizePhrase(alias) })
            .onConflictDoNothing()
            .run();
        }
        for (const gName of b.groups) {
          const groupId = groupIdByName.get(gName);
          if (groupId) tx.insert(schema.brandGroupMembers).values({ brandId: row.id, groupId }).onConflictDoNothing().run();
        }
      }
    }

    // Categories
    for (const c of seedCategories) insertSeedCategory(tx as unknown as Db, c, c.sortOrder);
    const categoryIdBySlug = new Map(tx.select().from(schema.categories).all().map((c) => [c.slug, c.id]));

    // Materials
    seedMaterials.forEach((m, i) => {
      tx.insert(schema.materials)
        .values({
          key: m.key,
          name: m.name,
          kind: m.kind,
          priority: m.priority,
          keywords: m.keywords ?? [],
          components: m.components ?? [],
          heavyThresholdPct: m.heavyThresholdPct ?? null,
          notes: m.notes ?? null,
          sortOrder: i + 1,
        })
        .onConflictDoNothing({ target: schema.materials.key })
        .run();
    });

    // Colors (all Neutral until you choose)
    insertSeedColors(tx as unknown as Db);

    // Conditions
    for (const c of seedConditions) {
      tx.insert(schema.conditions).values(c).onConflictDoNothing({ target: schema.conditions.key }).run();
    }

    // Search profiles (by name)
    for (const p of seedProfiles) {
      const exists = tx.select().from(schema.searchProfiles).where(eq(schema.searchProfiles.name, p.name)).get();
      if (exists) continue;
      const overrides: ProfileOverrides = {};
      if (p.groupNames) {
        overrides.brandScope = {
          groupIds: p.groupNames.map((n) => groupIdByName.get(n)).filter((x): x is number => x !== undefined),
          brandIds: [],
        };
      }
      if (p.categorySlugs) {
        overrides.categoryIds = p.categorySlugs.map((s) => categoryIdBySlug.get(s)).filter((x): x is number => x !== undefined);
      }
      tx.insert(schema.searchProfiles).values({ name: p.name, description: p.description, overrides, sortOrder: p.sortOrder }).run();
    }

    // Settings
    tx.insert(schema.settings).values({ key: "defaults", value: seedDefaults }).onConflictDoNothing().run();
    tx.insert(schema.settings).values({ key: "scan", value: seedScanSettings }).onConflictDoNothing().run();
    tx.insert(schema.settings).values({ key: "pricing", value: seedPricingSettings }).onConflictDoNothing().run();

    tx.insert(schema.meta)
      .values({ key: "seed_version", value: SEED_VERSION })
      .onConflictDoUpdate({ target: schema.meta.key, set: { value: SEED_VERSION } })
      .run();
  });
  return { seeded: true };
}

function insertSeedCategory(db: Db, c: (typeof seedCategories)[number], sortOrder: number): void {
  db.insert(schema.categories)
    .values({
      slug: c.slug,
      name: c.name,
      noun: c.noun,
      description: c.description,
      sizeSystem: c.sizeSystem,
      acceptedSizes: c.acceptedSizes,
      reviewSizes: c.reviewSizes,
      neckSizes: [],
      sleeveLengths: [],
      ebayCategoryIds: c.ebayCategoryIds,
      titleKeywords: c.titleKeywords,
      excludeKeywords: c.excludeKeywords,
      sortOrder,
    })
    .onConflictDoNothing({ target: schema.categories.slug })
    .run();
}

function insertSeedColors(db: Db): number {
  let added = 0;
  seedColors.forEach((c, i) => {
    added += db
      .insert(schema.colors)
      .values({ key: c.key, name: c.name, keywords: c.keywords, priority: "neutral", sortOrder: i + 1 })
      .onConflictDoNothing({ target: schema.colors.key })
      .run().changes;
  });
  return added;
}

/**
 * One-time changes for databases seeded by an earlier version of the app.
 * Each runs at most once per database (recorded in meta), so anything you
 * change or delete afterwards stays that way. A database seeded by this
 * version already has them, so there they change nothing.
 */
const SEED_UPGRADES: Array<{ key: string; run: (db: Db) => boolean }> = [
  {
    // Sweaters & Knitwear (eBay 11484) — skipped if you already have a category like it.
    key: "upgrade_2026_11_knitwear",
    run: (db) => {
      const seed = seedCategories.find((c) => c.slug === "knitwear")!;
      const existing = db.select().from(schema.categories).all();
      const clash = existing.some(
        (c) =>
          c.slug === seed.slug ||
          normalizePhrase(c.name) === normalizePhrase(seed.name) ||
          c.ebayCategoryIds.some((id) => seed.ebayCategoryIds.includes(id)),
      );
      if (clash) return false;
      insertSeedCategory(db, seed, Math.max(0, ...existing.map((c) => c.sortOrder)) + 1);
      return true;
    },
  },
  {
    // Stop accepting "New with defects" and "Pre-owned – Fair" (profile overrides are left alone).
    key: "upgrade_2026_11_conditions",
    run: (db) =>
      db
        .update(schema.conditions)
        .set({ accepted: false })
        .where(and(inArray(schema.conditions.key, ["new_with_defects", "preowned_fair"]), eq(schema.conditions.accepted, true)))
        .run().changes > 0,
  },
  {
    // Color preferences (all Neutral) — only if you have no colors yet.
    key: "upgrade_2026_11_colors",
    run: (db) => (db.select().from(schema.colors).get() ? false : insertSeedColors(db) > 0),
  },
];

/** Apply pending one-time upgrades. Returns whether any of them changed your settings. */
export function applySeedUpgrades(db: Db): { changed: boolean } {
  let changed = false;
  db.transaction((tx) => {
    for (const u of SEED_UPGRADES) {
      if (tx.select().from(schema.meta).where(eq(schema.meta.key, u.key)).get()) continue;
      if (u.run(tx as unknown as Db)) changed = true;
      tx.insert(schema.meta).values({ key: u.key, value: new Date().toISOString() }).run();
    }
  });
  return { changed };
}
