import type { ListingFacts } from "../../lib/matching/engine";
import { pricingMaterialKeys, type OnlinePrice } from "../../lib/pricing/engine";
import { buildRetailQuery, garmentTypeFor, productKeyOf } from "../../lib/retail/product";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadBrands, loadCategories, loadMaterials } from "./context";

/** The kind of item a listing is, for looking up its typical new price online. */
export interface ProductRef {
  productKey: string;
  brandId: number;
  categoryId: number;
  garmentType: string;
  materialKey: string | null;
  /** Built only from your own brand / material / garment words — never the eBay text. */
  query: string;
}

/** Maps a listing (title + its evaluation) to its kind of item; null without a known brand and category. */
export function productRefResolver(db: AppDb) {
  const brands = new Map(loadBrands(db).map((b) => [b.id, b]));
  const categories = new Map(loadCategories(db).map((c) => [c.id, c]));
  const materials = new Map(loadMaterials(db).map((m) => [m.key, m.name]));
  return (title: string, e: { brandId: number | null; categoryId: number | null; facts: unknown } | null | undefined): ProductRef | null => {
    if (!e || e.brandId === null || e.categoryId === null) return null;
    const brand = brands.get(e.brandId);
    const category = categories.get(e.categoryId);
    if (!brand || !category) return null;
    const garmentType = garmentTypeFor(title, category);
    const materialKey = pricingMaterialKeys((e.facts as ListingFacts | null | undefined)?.materialReading)[0] ?? null;
    return {
      productKey: productKeyOf({ brandId: brand.id, categoryId: category.id, garmentType, materialKey }),
      brandId: brand.id,
      categoryId: category.id,
      garmentType,
      materialKey,
      query: buildRetailQuery({ brandQuery: brand.searchQuery || brand.name, garmentType, materialName: materialKey ? materials.get(materialKey) ?? null : null }),
    };
  };
}

/**
 * Online prices by kind of item: the found price, or null when that kind was
 * looked up and not enough store prices were found (absent = never looked up).
 */
export function loadOnlinePrices(db: AppDb): Map<string, OnlinePrice | null> {
  const out = new Map<string, OnlinePrice | null>();
  for (const r of db.select().from(s.retailLookups).all()) {
    out.set(
      r.productKey,
      r.status === "found" && r.typicalMinor !== null ? { id: r.id, typicalMinor: r.typicalMinor, currency: r.currency, sourceCount: r.sourceCount } : null,
    );
  }
  return out;
}
