import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { normalizePhrase, stripAccents } from "../../lib/text";
import type { ProfileOverrides } from "../../lib/profiles/resolve";
import * as schema from "./schema";
import {
  SEED_VERSION,
  seedBrands,
  seedCategories,
  seedConditions,
  seedDefaults,
  seedGroups,
  seedMaterials,
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
    for (const c of seedCategories) {
      tx.insert(schema.categories)
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
          sortOrder: c.sortOrder,
        })
        .onConflictDoNothing({ target: schema.categories.slug })
        .run();
    }
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

    // Conditions
    for (const c of seedConditions) {
      tx.insert(schema.conditions).values({ ...c, accepted: true }).onConflictDoNothing({ target: schema.conditions.key }).run();
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

    tx.insert(schema.meta)
      .values({ key: "seed_version", value: SEED_VERSION })
      .onConflictDoUpdate({ target: schema.meta.key, set: { value: SEED_VERSION } })
      .run();
  });
  return { seeded: true };
}
