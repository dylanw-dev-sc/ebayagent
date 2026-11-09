import { and, eq, isNull } from "drizzle-orm";
import { formatBps, minorToInput, parseMoneyToMinor, parsePercentToBps } from "../../lib/money";
import { normalizePhrase } from "../../lib/text";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadBrands, loadCategories } from "./context";
import { recomputePricing } from "./evaluation";

/**
 * Bulk pricing setup: a brand × category grid and CSV import/export.
 * Retail baselines always come from you; blank cells/rows are never filled in.
 */

export interface GridCell {
  categoryId: number;
  brandId: number | null;
  /** null = cell left empty (an existing rule for it is removed). */
  retailMinor: number | null;
  /** null = use your default %. */
  bps: number | null;
}

export interface BulkResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

/** The rule for (category, brand, material); the grid only ever touches rules without a material. */
function findRule(db: AppDb, categoryId: number, brandId: number | null, materialKey: string | null = null) {
  return (
    db
      .select()
      .from(s.pricingRules)
      .where(
        and(
          eq(s.pricingRules.categoryId, categoryId),
          brandId === null ? isNull(s.pricingRules.brandId) : eq(s.pricingRules.brandId, brandId),
          materialKey === null ? isNull(s.pricingRules.materialKey) : eq(s.pricingRules.materialKey, materialKey),
        ),
      )
      .get() ?? null
  );
}

function upsertRule(
  db: AppDb,
  r: {
    categoryId: number;
    brandId: number | null;
    materialKey?: string | null;
    retailMinor: number;
    bps: number | null;
    retailSource?: string | null;
    notes?: string | null;
    active?: boolean;
  },
  result: BulkResult,
): void {
  const existing = findRule(db, r.categoryId, r.brandId, r.materialKey ?? null);
  if (existing) {
    const changed =
      existing.referenceRetailMinor !== r.retailMinor ||
      existing.allowedBps !== r.bps ||
      (r.retailSource !== undefined && r.retailSource !== null && r.retailSource !== existing.retailSource) ||
      (r.notes !== undefined && r.notes !== existing.notes) ||
      (r.active !== undefined && r.active !== existing.active);
    if (!changed) {
      result.skipped++;
      return;
    }
    db.update(s.pricingRules)
      .set({
        referenceRetailMinor: r.retailMinor,
        allowedBps: r.bps,
        retailSource: r.retailSource ?? existing.retailSource,
        notes: r.notes !== undefined ? r.notes : existing.notes,
        active: r.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(eq(s.pricingRules.id, existing.id))
      .run();
    result.updated++;
    return;
  }
  db.insert(s.pricingRules)
    .values({
      categoryId: r.categoryId,
      brandId: r.brandId,
      materialKey: r.materialKey ?? null,
      referenceRetailMinor: r.retailMinor,
      allowedBps: r.bps,
      retailSource: r.retailSource ?? null,
      notes: r.notes ?? null,
      active: r.active ?? true,
    })
    .run();
  result.created++;
}

/** A blank % (null) is fine — it means "use my default %". */
const validBps = (bps: number | null): boolean => bps === null || (Number.isInteger(bps) && bps > 0 && bps <= 10000);

/** Save the whole grid at once, then recalculate prices once. Blank % cells use your default %. */
export function saveRuleGrid(db: AppDb, cells: GridCell[], opts: { retailSource: string | null }): BulkResult {
  const result: BulkResult = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };
  const brandName = new Map(loadBrands(db).map((b) => [b.id, b.name]));
  const catName = new Map(loadCategories(db).map((c) => [c.id, c.name]));
  db.transaction((tx) => {
    for (const cell of cells) {
      const label = `${cell.brandId === null ? "All brands" : brandName.get(cell.brandId) ?? "?"} / ${catName.get(cell.categoryId) ?? "?"}`;
      if (cell.retailMinor === null) {
        const existing = findRule(tx as unknown as AppDb, cell.categoryId, cell.brandId);
        if (existing) {
          tx.delete(s.pricingRules).where(eq(s.pricingRules.id, existing.id)).run();
          result.deleted++;
        }
        continue;
      }
      if (cell.retailMinor <= 0) {
        result.errors.push(`${label}: retail must be more than $0.`);
        continue;
      }
      if (!validBps(cell.bps)) {
        result.errors.push(`${label}: allowed % must be between 0.01 and 100 (or blank for your default).`);
        continue;
      }
      upsertRule(tx as unknown as AppDb, { categoryId: cell.categoryId, brandId: cell.brandId, retailMinor: cell.retailMinor, bps: cell.bps, retailSource: opts.retailSource }, result);
    }
  });
  recomputePricing(db);
  return result;
}

// --- CSV ---------------------------------------------------------------------------------

export const RULE_CSV_HEADER = ["category", "brand", "material", "reference_retail_usd", "allowed_percent", "retail_source", "notes", "active"];
const ALL_BRANDS = "All brands";

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Quote when needed, and neutralize spreadsheet formulas in text cells. */
function csvCell(value: string, text = true): string {
  let v = value;
  if (text && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][], numericColumns: number[] = []): string {
  return rows.map((r) => r.map((c, i) => csvCell(c, !numericColumns.includes(i))).join(",")).join("\r\n") + "\r\n";
}

/** Your rules as CSV; with `template`, also a blank row for every enabled brand × category without a rule. */
export function exportRulesCsv(db: AppDb, opts: { template: boolean }): string {
  const categories = loadCategories(db).filter((c) => c.enabled);
  const brands = loadBrands(db).filter((b) => b.enabled);
  const rules = db.select().from(s.pricingRules).all();
  const allCategories = loadCategories(db);
  const allBrands = loadBrands(db);
  const materialNames = new Map(db.select().from(s.materials).all().map((m) => [m.key, m.name]));
  const rows: string[][] = [RULE_CSV_HEADER];
  const ruleRow = (r: (typeof rules)[number]) => [
    allCategories.find((c) => c.id === r.categoryId)?.name ?? "",
    r.brandId === null ? ALL_BRANDS : allBrands.find((b) => b.id === r.brandId)?.name ?? "",
    r.materialKey === null ? "" : materialNames.get(r.materialKey) ?? r.materialKey,
    minorToInput(r.referenceRetailMinor),
    r.allowedBps === null ? "" : formatBps(r.allowedBps).replace("%", ""),
    r.retailSource ?? "",
    r.notes ?? "",
    r.active ? "yes" : "no",
  ];
  if (!opts.template) {
    for (const r of rules) rows.push(ruleRow(r));
  } else {
    for (const c of categories) {
      for (const brandId of [null, ...brands.map((b) => b.id)]) {
        const r = rules.find((x) => x.categoryId === c.id && x.brandId === brandId && x.materialKey === null);
        rows.push(r ? ruleRow(r) : [c.name, brandId === null ? ALL_BRANDS : brands.find((b) => b.id === brandId)!.name, "", "", "", "", "", "yes"]);
      }
    }
    // Material-specific rules you already have are included too.
    for (const r of rules) if (r.materialKey !== null) rows.push(ruleRow(r));
  }
  const header = rows[0];
  const body = rows
    .slice(1)
    .sort((a, b) => a[0].localeCompare(b[0]) || (a[1] === ALL_BRANDS ? -1 : b[1] === ALL_BRANDS ? 1 : a[1].localeCompare(b[1])) || a[2].localeCompare(b[2]));
  return toCsv([header, ...body], [3, 4]);
}

/**
 * Merge rules from CSV. Rows with an empty retail price are ignored (they
 * never delete or invent anything). Problems are reported per line.
 */
export function importRulesCsv(db: AppDb, text: string): BulkResult {
  const result: BulkResult = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };
  const rows = parseCsv(text);
  if (rows.length === 0) {
    result.errors.push("The file is empty.");
    return result;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ["category", "brand", "reference_retail_usd", "allowed_percent"];
  const missing = required.filter((r) => col(r) < 0);
  if (missing.length) {
    result.errors.push(`Missing column(s): ${missing.join(", ")}. Expected: ${RULE_CSV_HEADER.join(", ")}.`);
    return result;
  }
  const categories = loadCategories(db);
  const brands = loadBrands(db);
  const findCategory = (v: string) => {
    const n = normalizePhrase(v);
    return categories.find((c) => normalizePhrase(c.name) === n || normalizePhrase(c.slug) === n);
  };
  const findBrand = (v: string) => {
    const n = normalizePhrase(v);
    return brands.find((b) => [b.name, ...b.aliases].some((x) => normalizePhrase(x) === n));
  };
  const materials = db.select().from(s.materials).all();
  const findMaterial = (v: string) => {
    const n = normalizePhrase(v);
    return materials.find((m) => normalizePhrase(m.name) === n || normalizePhrase(m.key.replace(/_/g, " ")) === n);
  };
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim().replace(/^'(?=[=+\-@])/, "") : "");

  db.transaction((tx) => {
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const retailText = get(r, "reference_retail_usd");
      if (retailText === "") {
        result.skipped++;
        return;
      }
      const cat = findCategory(get(r, "category"));
      if (!cat) return void result.errors.push(`Line ${line}: unknown category “${get(r, "category")}”.`);
      const brandText = get(r, "brand");
      const isAll = brandText === "" || /^(all brands|all|\*)$/i.test(brandText);
      const brand = isAll ? null : findBrand(brandText);
      if (!isAll && !brand) return void result.errors.push(`Line ${line}: unknown brand “${brandText}”.`);
      const materialText = get(r, "material");
      const material = materialText === "" ? null : findMaterial(materialText);
      if (materialText !== "" && !material) return void result.errors.push(`Line ${line}: unknown material “${materialText}”.`);
      const retail = parseMoneyToMinor(retailText);
      if (retail === null || retail <= 0) return void result.errors.push(`Line ${line}: retail price “${retailText}” isn't a valid amount.`);
      const percentText = get(r, "allowed_percent");
      const bps = percentText === "" ? null : parsePercentToBps(percentText);
      if ((percentText !== "" && bps === null) || !validBps(bps)) {
        return void result.errors.push(`Line ${line}: allowed percent “${percentText}” must be between 0.01 and 100 (or blank for your default).`);
      }
      const activeText = get(r, "active").toLowerCase();
      upsertRule(
        tx as unknown as AppDb,
        {
          categoryId: cat.id,
          brandId: brand?.id ?? null,
          materialKey: material?.key ?? null,
          retailMinor: retail,
          bps,
          retailSource: get(r, "retail_source") || null,
          notes: col("notes") >= 0 ? get(r, "notes") || null : undefined,
          active: activeText === "" ? true : !["no", "false", "0", "inactive", "off"].includes(activeText),
        },
        result,
      );
    });
  });
  recomputePricing(db);
  return result;
}

export function describeBulkResult(r: BulkResult): string {
  const parts = [
    r.created ? `${r.created} added` : "",
    r.updated ? `${r.updated} updated` : "",
    r.deleted ? `${r.deleted} removed` : "",
    r.skipped ? `${r.skipped} unchanged/blank` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}. Prices recalculated.` : "No changes.";
}
